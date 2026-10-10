import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import Security
import UIKit

/// Public-client sign-in via the system browser. Not MSAL-browser inside WKWebView.
/// Redirect must match IOS_ENTRA_REDIRECT_URI in src/iosPublicConfig.ts.
enum GardenEntra {
    static let redirectURI = "msauth.com.pjwinstone.gardenplanting://auth"
    static let scheme = "msauth.com.pjwinstone.gardenplanting"
}

/// One browser sign-in and every call waiting on it.
/// The session callback retains this, so the calls can still be rejected if the plugin is gone.
private final class InteractiveSignIn {
    private let lock = NSLock()
    private var waiters: [CAPPluginCall] = []
    private var settled = false

    /// False when this attempt has already finished.
    func join(_ call: CAPPluginCall) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if settled { return false }
        waiters.append(call)
        return true
    }

    func finish(_ body: (CAPPluginCall) -> Void) {
        lock.lock()
        if settled {
            lock.unlock()
            return
        }
        settled = true
        let pending = waiters
        waiters.removeAll()
        lock.unlock()
        for call in pending {
            body(call)
        }
    }
}

@objc(GardenAuthPlugin)
public class GardenAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GardenAuthPlugin"
    public let jsName = "GardenAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acquireToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
    ]

    private let presenter = AuthPresenter()
    private let tokenQueue = DispatchQueue(label: "garden.auth.refresh")
    private let accessLock = NSLock()
    private let interactiveLock = NSLock()
    private var session: ASWebAuthenticationSession?
    private var accessToken: String?
    private var accessExpiry: Date?
    private var refreshInFlight = false
    private var refreshWaiters: [(RefreshOutcome) -> Void] = []
    private var interactiveSignIn: InteractiveSignIn?

    deinit {
        interactiveSignIn?.finish { $0.reject("Sign-in was interrupted.") }
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let stored = KeychainSession.load() else {
            call.resolve(["signedIn": false])
            return
        }
        call.resolve(stored.pluginResult(signedIn: true))
    }

    @objc func signIn(_ call: CAPPluginCall) {
        let clientId = call.getString("clientId") ?? ""
        let tenant = call.getString("tenantId") ?? "common"
        let redirect = call.getString("redirectUri") ?? GardenEntra.redirectURI
        let scopes = call.getString("scopes") ?? "User.Read Files.ReadWrite offline_access openid profile"
        guard !clientId.isEmpty else {
            call.reject("Microsoft sign-in is not configured yet.")
            return
        }
        DispatchQueue.main.async {
            self.interactive(call: call, clientId: clientId, tenant: tenant, redirect: redirect, scopes: scopes)
        }
    }

    @objc func acquireToken(_ call: CAPPluginCall) {
        let allowInteractive = call.getBool("allowInteractive") ?? false
        let clientId = call.getString("clientId") ?? ""
        let tenant = call.getString("tenantId") ?? "common"
        let scopes = call.getString("scopes") ?? "User.Read Files.ReadWrite offline_access openid profile"
        if let token = cachedAccessToken() {
            var result = KeychainSession.load()?.pluginResult(signedIn: true) ?? ["signedIn": true]
            result["accessToken"] = token
            call.resolve(result)
            return
        }
        guard let stored = KeychainSession.load() else {
            if allowInteractive && !clientId.isEmpty {
                DispatchQueue.main.async {
                    self.interactive(call: call, clientId: clientId, tenant: tenant, redirect: GardenEntra.redirectURI, scopes: scopes)
                }
            } else {
                call.resolve([
                    "interactionRequired": true,
                    "error": allowInteractive
                        ? "Not signed in. Tap Sign in with Microsoft first."
                        : "Sign in to upload.",
                ])
            }
            return
        }
        enqueueRefresh(stored: stored, clientId: clientId, tenant: tenant, scopes: scopes) { [weak self] outcome in
            switch outcome {
            case .token(let token, let session, let expiry):
                self?.remember(token: token, expiry: expiry, session: session)
                var result = session.pluginResult(signedIn: true)
                result["accessToken"] = token
                call.resolve(result)
            case .interactionRequired(let message):
                if allowInteractive && !clientId.isEmpty {
                    DispatchQueue.main.async {
                        self?.interactive(call: call, clientId: clientId, tenant: tenant, redirect: GardenEntra.redirectURI, scopes: scopes)
                    }
                } else {
                    call.resolve(["interactionRequired": true, "error": message])
                }
            case .failed(let message):
                call.resolve(["interactionRequired": false, "error": message])
            }
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        clearCachedAccess()
        KeychainSession.clear()
        call.resolve()
    }

    private func cachedAccessToken() -> String? {
        accessLock.lock()
        defer { accessLock.unlock() }
        guard let accessToken, let accessExpiry, accessExpiry > Date() else { return nil }
        return accessToken
    }

    private func remember(token: String, expiry: Date, session: StoredSession) {
        accessLock.lock()
        accessToken = token
        accessExpiry = expiry
        accessLock.unlock()
        KeychainSession.save(session)
    }

    private func clearCachedAccess() {
        accessLock.lock()
        accessToken = nil
        accessExpiry = nil
        accessLock.unlock()
    }

    /// A second sign-in while the browser or code exchange is open joins that attempt.
    private func interactive(call: CAPPluginCall, clientId: String, tenant: String, redirect: String, scopes: String) {
        interactiveLock.lock()
        if let existing = interactiveSignIn, existing.join(call) {
            interactiveLock.unlock()
            return
        }
        interactiveSignIn = nil
        interactiveLock.unlock()

        let pair = pkce()
        var components = URLComponents(string: "https://login.microsoftonline.com/\(tenant)/oauth2/v2.0/authorize")
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_mode", value: "query"),
            URLQueryItem(name: "scope", value: scopes),
            URLQueryItem(name: "code_challenge", value: pair.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let url = components?.url else {
            call.reject("Could not build the Microsoft sign-in URL.")
            return
        }

        let scheme = URL(string: redirect)?.scheme ?? GardenEntra.scheme
        let attempt = InteractiveSignIn()
        let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
            guard let self else {
                attempt.finish { $0.reject("Sign-in was interrupted.") }
                return
            }
            if let error {
                if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    self.finishInteractive(attempt) { $0.reject("cancelled", "USER_CANCELLED") }
                } else {
                    let message = error.localizedDescription
                    self.finishInteractive(attempt) { $0.reject(message) }
                }
                return
            }
            guard let callback, let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems else {
                self.finishInteractive(attempt) { $0.reject("Microsoft did not return a sign-in result.") }
                return
            }
            if let err = items.first(where: { $0.name == "error" })?.value {
                let desc = items.first(where: { $0.name == "error_description" })?.value ?? err
                self.finishInteractive(attempt) { $0.reject(desc) }
                return
            }
            guard let code = items.first(where: { $0.name == "code" })?.value else {
                self.finishInteractive(attempt) { $0.reject("Microsoft did not return an authorization code.") }
                return
            }
            self.exchangeCode(
                code: code,
                verifier: pair.verifier,
                clientId: clientId,
                tenant: tenant,
                redirect: redirect,
                scopes: scopes,
                attempt: attempt
            )
        }
        auth.presentationContextProvider = presenter
        auth.prefersEphemeralWebBrowserSession = false
        interactiveLock.lock()
        if let existing = interactiveSignIn, existing.join(call) {
            interactiveLock.unlock()
            return
        }
        _ = attempt.join(call)
        interactiveSignIn = attempt
        session = auth
        interactiveLock.unlock()
        if !auth.start() {
            finishInteractive(attempt) { $0.reject("The system browser did not open.") }
        }
    }

    /// Hands the same resolve or reject to every call that joined this sign-in.
    private func finishInteractive(_ attempt: InteractiveSignIn, _ body: (CAPPluginCall) -> Void) {
        attempt.finish(body)
        interactiveLock.lock()
        if interactiveSignIn === attempt {
            interactiveSignIn = nil
            session = nil
        }
        interactiveLock.unlock()
    }

    private func exchangeCode(
        code: String,
        verifier: String,
        clientId: String,
        tenant: String,
        redirect: String,
        scopes: String,
        attempt: InteractiveSignIn
    ) {
        let body = form([
            "client_id": clientId,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect,
            "code_verifier": verifier,
            "scope": scopes,
        ])
        tokenRequest(tenant: tenant, body: body) { [weak self] outcome in
            guard let self else {
                attempt.finish { $0.reject("Sign-in was interrupted.") }
                return
            }
            switch outcome {
            case .token(let token, let refresh, let expires, let idToken):
                let stored = StoredSession(refreshToken: refresh, idToken: idToken, tenantId: tenant)
                let expiry = Date().addingTimeInterval(expires)
                self.remember(token: token, expiry: expiry, session: stored)
                var result = stored.pluginResult(signedIn: true)
                result["accessToken"] = token
                self.finishInteractive(attempt) { $0.resolve(result) }
            case .interactionRequired(let message):
                self.clearCachedAccess()
                self.finishInteractive(attempt) { $0.resolve(["interactionRequired": true, "error": message]) }
            case .failed(let message):
                self.finishInteractive(attempt) { $0.reject(message) }
            }
        }
    }

    /// Concurrent acquireToken calls share one refresh. Each waiter gets the same outcome.
    private func enqueueRefresh(
        stored: StoredSession,
        clientId: String,
        tenant: String,
        scopes: String,
        done: @escaping (RefreshOutcome) -> Void
    ) {
        tokenQueue.async {
            self.refreshWaiters.append(done)
            guard !self.refreshInFlight else { return }
            self.refreshInFlight = true
            self.refresh(stored: stored, clientId: clientId, tenant: tenant, scopes: scopes) { outcome in
                self.tokenQueue.async {
                    let waiters = self.refreshWaiters
                    self.refreshWaiters.removeAll()
                    self.refreshInFlight = false
                    for waiter in waiters {
                        waiter(outcome)
                    }
                }
            }
        }
    }

    private func refresh(
        stored: StoredSession,
        clientId: String,
        tenant: String,
        scopes: String,
        done: @escaping (RefreshOutcome) -> Void
    ) {
        guard !clientId.isEmpty else {
            done(.failed("Microsoft sign-in is not configured yet."))
            return
        }
        let body = form([
            "client_id": clientId,
            "grant_type": "refresh_token",
            "refresh_token": stored.refreshToken,
            "scope": scopes,
        ])
        tokenRequest(tenant: tenant, body: body) { [weak self] outcome in
            switch outcome {
            case .token(let token, let refresh, let expires, let idToken):
                var next = stored
                next.refreshToken = refresh
                if let idToken {
                    next = StoredSession(refreshToken: refresh, idToken: idToken, tenantId: stored.tenantId)
                }
                let expiry = Date().addingTimeInterval(expires)
                done(.token(token, next, expiry))
            case .interactionRequired(let message):
                KeychainSession.clear()
                self?.clearCachedAccess()
                done(.interactionRequired(message))
            case .failed(let message):
                done(.failed(message))
            }
        }
    }

    private func tokenRequest(tenant: String, body: String, done: @escaping (TokenOutcome) -> Void) {
        guard let url = URL(string: "https://login.microsoftonline.com/\(tenant)/oauth2/v2.0/token") else {
            done(.failed("Could not build the token URL."))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = body.data(using: .utf8)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                done(.failed(error.localizedDescription))
                return
            }
            guard let data else {
                done(.failed("Microsoft returned an empty token response."))
                return
            }
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let token = json["access_token"] as? String, let refresh = json["refresh_token"] as? String {
                let expires = (json["expires_in"] as? NSNumber)?.doubleValue ?? 3600
                let idToken = json["id_token"] as? String
                done(.token(token, refresh, max(expires - 120, 60), idToken))
                return
            }
            let code = json["error"] as? String ?? ""
            let desc = json["error_description"] as? String ?? "Microsoft token request failed (\(status))."
            if code == "invalid_grant" || code == "interaction_required" {
                done(.interactionRequired("Sign in to upload."))
            } else {
                done(.failed(desc))
            }
        }.resume()
    }

    private func pkce() -> (verifier: String, challenge: String) {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = base64url(Data(bytes))
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return (verifier, base64url(Data(digest)))
    }

    private func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func form(_ fields: [String: String]) -> String {
        fields.map { key, value in
            "\(key)=\(formEscape(value))"
        }.joined(separator: "&")
    }

    private func formEscape(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

private enum TokenOutcome {
    case token(String, String, TimeInterval, String?)
    case interactionRequired(String)
    case failed(String)
}

private enum RefreshOutcome {
    case token(String, StoredSession, Date)
    case interactionRequired(String)
    case failed(String)
}

private struct StoredSession {
    var refreshToken: String
    var name: String?
    var username: String
    var homeAccountId: String
    var localAccountId: String
    var tenantId: String

    init(refreshToken: String, idToken: String?, tenantId: String) {
        self.refreshToken = refreshToken
        self.tenantId = tenantId
        let claims = StoredSession.claims(from: idToken)
        let oid = claims["oid"] as? String ?? claims["sub"] as? String ?? "account"
        let tid = claims["tid"] as? String ?? tenantId
        username = claims["preferred_username"] as? String ?? claims["email"] as? String ?? oid
        name = claims["name"] as? String
        localAccountId = oid
        homeAccountId = "\(oid).\(tid)"
        self.tenantId = tid
    }

    init(refreshToken: String, name: String?, username: String, homeAccountId: String, localAccountId: String, tenantId: String) {
        self.refreshToken = refreshToken
        self.name = name
        self.username = username
        self.homeAccountId = homeAccountId
        self.localAccountId = localAccountId
        self.tenantId = tenantId
    }

    func pluginResult(signedIn: Bool) -> [String: Any] {
        var result: [String: Any] = [
            "signedIn": signedIn,
            "username": username,
            "homeAccountId": homeAccountId,
            "localAccountId": localAccountId,
            "tenantId": tenantId,
        ]
        if let name { result["name"] = name }
        return result
    }

    static func claims(from idToken: String?) -> [String: Any] {
        guard let idToken else { return [:] }
        let parts = idToken.split(separator: ".")
        guard parts.count >= 2 else { return [:] }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = (4 - payload.count % 4) % 4
        payload += String(repeating: "=", count: pad)
        guard let data = Data(base64Encoded: payload),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}

private enum KeychainSession {
    static let service = "com.pjwinstone.gardenplanting.entra"
    static let account = "session"

    static func save(_ session: StoredSession) {
        let obj: [String: String] = [
            "refreshToken": session.refreshToken,
            "username": session.username,
            "homeAccountId": session.homeAccountId,
            "localAccountId": session.localAccountId,
            "tenantId": session.tenantId,
            "name": session.name ?? "",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> StoredSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let refresh = obj["refreshToken"], !refresh.isEmpty else { return nil }
        return StoredSession(
            refreshToken: refresh,
            name: obj["name"]?.isEmpty == false ? obj["name"] : nil,
            username: obj["username"] ?? "",
            homeAccountId: obj["homeAccountId"] ?? "",
            localAccountId: obj["localAccountId"] ?? "",
            tenantId: obj["tenantId"] ?? "common"
        )
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private final class AuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return window
        }
        return scenes.first?.windows.first ?? UIWindow()
    }
}
