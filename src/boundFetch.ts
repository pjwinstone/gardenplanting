/**
 * Safari / WKWebView throw "Can only call Window.fetch on instances of Window" when fetch is
 * called as a method of another object (client.fetch(url)), because `this` is not window.
 * Store this wrapper instead of the bare global whenever fetch goes into an object or variable.
 */
export const boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** A fetch that is safe to store on an object and call as obj.fetch(...). */
export function callableFetch(impl?: typeof fetch): typeof fetch {
  if (!impl) return boundFetch;
  return (input, init) => impl(input, init);
}
