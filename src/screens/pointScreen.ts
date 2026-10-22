/**
 * Home + Add point screens (rebuild). Drawn from workflow/point.net.yaml: every step uses one
 * template — roller row, title, what it needs, inputs, photo strip, hints, then the button row
 * Photos | Back | Next | Cancel. A disabled button says why. The roller moves only on the
 * user's scroll or Next/Back.
 */
import type { GardenDocument, Photo } from '../model';
import { POST_SEPARATION_DEFAULT_M } from '../solver/controlCluster';
import { attachRollerWheel } from '../workflows/guided/guidedRoller';
import {
  addRunPhoto,
  baseGridOf,
  cancelRun,
  baseWarnings,
  diagonalCheck,
  edit,
  ensurePhotoPoint,
  goBack,
  goNext,
  goTo,
  hintsFor,
  isDone,
  isFirstBasePoint,
  livePhotos,
  newPointRun,
  nextBaseId,
  nextNeeded,
  PHOTO_LAYERS,
  photoPointSolve,
  retakePhoto,
  rows,
  saveBasePoint,
  savePhotoPoint,
  stepReason,
  type PhotoLayer,
  type PointRun,
} from './pointRun';
import { pointNet, t } from './stepNet';

export type Screen = 'home' | 'add-point';

export interface ScreenHost {
  getDoc(): GardenDocument;
  setDoc(doc: GardenDocument): void;
  rerender(): void;
  /** Open the camera; the host attaches the photo to `pointId` and returns its id. */
  takePhoto(pointId: string, done: (photoId: string) => void): void;
  /** Start (or resume) the circle test (existing flow). */
  openCircleTest(): void;
  /** Move superseded photos to the archive now. */
  drainArchive(): void;
}

const RUN_KEY = 'garden-survey:point-run';
const ROW_PX = 44;
const WHEEL_ROWS = 5;

let screen: Screen = 'home';
let run: PointRun | null = null;
let viewerPhotoId: string | null = null;
let notice: string | null = null;
let host: ScreenHost | null = null;
let lastCentred: string | null = null;
let savedScroll: number | undefined;
let touching = () => false;

function persist(): void {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {
    /* private mode */
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    const parsed = raw ? (JSON.parse(raw) as PointRun) : null;
    if (parsed && parsed.version === 1) {
      run = parsed;
      screen = 'add-point';
    }
  } catch {
    /* ignore */
  }
}

export function installScreens(h: ScreenHost): void {
  host = h;
  restore();
}

export function currentScreen(): Screen {
  return screen;
}

/** Tests and Tools: reset to Home. */
export function resetScreens(): void {
  screen = 'home';
  run = null;
  viewerPhotoId = null;
  notice = null;
  lastCentred = null;
  savedScroll = undefined;
  persist();
}

export function currentPointRun(): PointRun | null {
  return run;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(text: string, cmd: string, opts: { primary?: boolean; reason?: string | null; testid?: string; data?: Record<string, string> } = {}): HTMLButtonElement {
  const b = el('button', 'screen-btn' + (opts.primary ? ' screen-primary' : ''), text);
  b.type = 'button';
  b.dataset.cmd = cmd;
  if (opts.testid) b.dataset.testid = opts.testid;
  for (const [k, v] of Object.entries(opts.data ?? {})) b.dataset[k] = v;
  if (opts.reason) {
    b.disabled = true;
    b.title = opts.reason;
    b.setAttribute('aria-description', opts.reason);
  }
  return b;
}

function numberInput(label: string, field: string, value: number | undefined, testid: string): HTMLElement {
  const wrap = el('label', 'screen-field');
  wrap.append(el('span', '', label));
  const input = el('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = value == null ? '' : String(value);
  input.dataset.cmd = 'screen-input';
  input.dataset.field = field;
  input.dataset.testid = testid;
  wrap.append(input);
  return wrap;
}

function choiceButton(text: string, cmd: string, selected: boolean, data: Record<string, string>, testid: string, help?: string): HTMLElement {
  const b = btn(text, cmd, { testid, data });
  b.classList.add('screen-choice');
  if (selected) b.classList.add('screen-choice-on');
  b.setAttribute('aria-pressed', String(selected));
  if (help) b.append(el('small', '', help));
  return b;
}

// ------------------------------------------------------------------ render

export function renderScreens(doc: GardenDocument): HTMLElement | null {
  if (screen === 'home') return renderHome();
  if (!run) return null;
  if (viewerPhotoId) return renderViewer(doc, run, viewerPhotoId);
  return renderStep(doc, run);
}

function renderHome(): HTMLElement {
  const sheet = el('section', 'screen-sheet screen-home');
  sheet.dataset.testid = 'screen-home';
  sheet.append(btn('Add point', 'screen-start-point', { primary: true, testid: 'home-add-point' }));
  sheet.append(btn('Circle test', 'screen-circle-test', { primary: true, testid: 'home-circle-test' }));
  return sheet;
}

function renderStep(doc: GardenDocument, r: PointRun): HTMLElement {
  const sheet = el('section', 'screen-sheet workflow-roller-sheet');
  sheet.dataset.testid = 'screen-step';
  sheet.dataset.step = r.current;
  const list = rows(r);
  const step = list.find((s) => s.id === r.current) ?? list[0]!;
  const solve = r.type === 'photo' && livePhotos(doc, r).length ? photoPointSolve(doc, r) : undefined;

  // Roller.
  const wheel = el('div', 'roller-wheel');
  const h = ROW_PX * WHEEL_ROWS;
  wheel.style.height = `${h}px`;
  const cap = el('div', 'roller-cap');
  cap.style.top = `${(h - ROW_PX) / 2}px`;
  wheel.append(cap);
  const rl = el('div', 'roller-list');
  rl.dataset.rollerList = '1';
  rl.setAttribute('role', 'listbox');
  const pad = (h - ROW_PX) / 2;
  rl.style.paddingTop = `${pad}px`;
  rl.style.paddingBottom = `${pad}px`;
  const nextId = nextNeeded(r);
  list.forEach((s, i) => {
    const row = el('div', 'roller-row');
    row.dataset.stepId = s.id;
    row.setAttribute('role', 'option');
    row.append(el('span', 'roller-n', String(i + 1)));
    const done = isDone(r, s.id);
    row.append(el('span', `roller-ic ${done ? 'ok' : ''}`, done ? '✓' : ''));
    row.append(el('span', 'roller-t' + (s.id === r.current ? ' roller-t-cur' : ''), s.title));
    if (s.id === nextId && s.id !== r.current) {
      const dot = el('span', 'roller-next-dot');
      dot.dataset.testid = 'roller-next-needed';
      dot.setAttribute('aria-label', 'Next needed');
      row.append(dot);
    }
    rl.append(row);
  });
  wheel.append(rl);
  sheet.append(wheel);
  const ids = list.map((s) => s.id);
  const current = r.current;
  requestAnimationFrame(() => {
    if (!rl.isConnected) return;
    const row = rl.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(current)}"]`);
    // Centre only when the current row changed (Next/Back/settle); else keep the user's scroll.
    if (lastCentred !== current || savedScroll === undefined) {
      if (row) rl.scrollTop = row.offsetTop - pad;
      lastCentred = current;
    } else rl.scrollTop = savedScroll;
    savedScroll = rl.scrollTop;
    rl.addEventListener('scroll', () => { if (rl.isConnected) savedScroll = rl.scrollTop; }, { passive: true });
    const handle = attachRollerWheel(wheel, ids, current, (stepId) => {
      if (!run) return;
      run = goTo(run, stepId);
      lastCentred = stepId;
      persist();
      host?.rerender();
    });
    touching = handle.touching;
  });

  // Template: title, needs, body, photo strip, hints, notice, buttons.
  sheet.append(el('h2', 'screen-title', step.title));
  sheet.append(el('p', 'screen-needs', step.needs));
  sheet.append(renderBody(doc, r, step.id, solve));
  sheet.append(renderStrip(doc, r));
  for (const hint of hintsFor(doc, r, solve)) {
    const box = el('div', 'screen-hint');
    box.dataset.testid = `hint-${hint.id}`;
    box.append(el('span', '', hint.text));
    box.append(btn(t(pointNet, 'dismiss_btn'), 'screen-dismiss-hint', { data: { hint: hint.id }, testid: 'hint-dismiss' }));
    sheet.append(box);
  }
  if (notice) sheet.append(el('p', 'workflow-notice', notice));

  const reason = stepReason(doc, r, step.id, solve);
  const at = list.findIndex((s) => s.id === step.id);
  const last = step.id === 'save_base' || step.id === 'save_photo';
  const row = el('div', 'screen-buttons');
  const photoPoint = r.type === 'photo' && isDone(r, 'layer');
  row.append(btn(t(pointNet, 'photos_btn'), 'screen-take-photo', { reason: photoPoint ? null : t(pointNet, 'why', { reason: pointNet.steps.find((s) => s.id === 'layer')!.reasons.no_layer! }), testid: 'btn-photos' }));
  row.append(btn(t(pointNet, 'back_btn'), 'screen-back', { reason: at <= 0 ? t(pointNet, 'at_first_step') : null, testid: 'btn-back' }));
  const nextBtn = btn(last ? t(pointNet, 'save_btn') : t(pointNet, 'next_btn'), last ? 'screen-save' : 'screen-next', { primary: true, reason, testid: 'btn-next' });
  row.append(nextBtn);
  row.append(btn(t(pointNet, 'cancel_btn'), 'screen-cancel', { testid: 'btn-cancel' }));
  sheet.append(row);
  if (reason) {
    const why = el('p', 'screen-why', t(pointNet, 'why', { reason }));
    why.dataset.testid = 'next-why';
    sheet.append(why);
  }
  return sheet;
}

function renderBody(doc: GardenDocument, r: PointRun, stepId: string, solve: ReturnType<typeof photoPointSolve> | undefined): HTMLElement {
  const body = el('div', 'screen-body');
  const first = isFirstBasePoint(doc);
  switch (stepId) {
    case 'choose_type':
      body.append(choiceButton(t(pointNet, 'type_base'), 'screen-type', r.type === 'base', { value: 'base' }, 'type-base', t(pointNet, 'type_base_help')));
      body.append(choiceButton(t(pointNet, 'type_photo'), 'screen-type', r.type === 'photo', { value: 'photo' }, 'type-photo', t(pointNet, 'type_photo_help')));
      break;
    case 'from_point':
      if (first) body.append(el('p', '', t(pointNet, 'first_base')));
      else {
        body.append(el('p', '', t(pointNet, 'new_point_is', { id: nextBaseId(doc) })));
        const warn = baseWarnings(doc);
        for (const id of baseGridOf(doc).ids) {
          const b = choiceButton(id, 'screen-from', r.from === id, { value: id }, `from-${id}`, warn[id]?.text);
          if (warn[id]) b.classList.add(Math.abs(warn[id]!.w) > 2 * 3.29 ? 'screen-choice-red' : 'screen-choice-amber');
          body.append(b);
        }
      }
      break;
    case 'offsets':
      if (first) body.append(el('p', '', t(pointNet, 'not_needed_first')));
      else {
        body.append(numberInput(t(pointNet, 'north_m'), 'northM', r.northM, 'in-north'));
        body.append(numberInput(t(pointNet, 'east_m'), 'eastM', r.eastM, 'in-east'));
      }
      break;
    case 'diagonal': {
      if (first) {
        body.append(el('p', '', t(pointNet, 'not_needed_first')));
        break;
      }
      body.append(numberInput(t(pointNet, 'diagonal_m'), 'diagonalM', r.diagonalM, 'in-diagonal'));
      if (r.northM != null && r.eastM != null) body.append(el('p', '', t(pointNet, 'diagonal_expected', { expected: Math.hypot(r.northM, r.eastM).toFixed(3) })));
      const c = diagonalCheck(doc, r);
      if (c) {
        const msg = c.warning ? c.warning.text : t(pointNet, 'diagonal_ok', { diff: c.diffMm });
        const line = el('p', c.warning ? 'screen-amber' : 'screen-green', msg);
        line.dataset.testid = 'diagonal-check';
        body.append(line);
      } else if (r.diagonalM == null) body.append(el('p', 'screen-amber', t(pointNet, 'diagonal_missing')));
      break;
    }
    case 'post':
      body.append(choiceButton(t(pointNet, 'single_sleeve'), 'screen-post', !r.twoSleeve, { value: 'single' }, 'post-single'));
      body.append(choiceButton(t(pointNet, 'two_sleeve'), 'screen-post', !!r.twoSleeve, { value: 'two' }, 'post-two'));
      if (r.twoSleeve) body.append(numberInput(t(pointNet, 'separation_m'), 'separationM', r.separationM ?? POST_SEPARATION_DEFAULT_M, 'in-separation'));
      break;
    case 'save_base':
      body.append(el('p', '', t(pointNet, 'summary_base', {
        id: nextBaseId(doc),
        north: first ? 0 : r.northM ?? '',
        east: first ? 0 : r.eastM ?? '',
        from: first ? 'BAS01' : r.from ?? '',
        post: r.twoSleeve ? `${t(pointNet, 'two_sleeve')} ${(r.separationM ?? POST_SEPARATION_DEFAULT_M).toFixed(2)} m` : t(pointNet, 'single_sleeve'),
      })));
      break;
    case 'layer':
      for (const layer of PHOTO_LAYERS) body.append(choiceButton(t(pointNet, `layer_${layer}`), 'screen-layer', r.layer === layer, { value: layer }, `layer-${layer}`));
      break;
    case 'photos':
      body.append(btn(t(pointNet, 'take_photo'), 'screen-take-photo', { primary: true, testid: 'take-photo' }));
      break;
    case 'solve':
    case 'save_photo': {
      if (!solve) break;
      const chip = el('div', `screen-chip screen-chip-${solve.cls}`, solve.cls === 'none' ? solve.message : `${solve.cls.toUpperCase()}${solve.twoPointFix ? ' · 2-point fix (unchecked)' : ''}`);
      chip.dataset.testid = 'solve-status';
      body.append(chip);
      if (solve.cls !== 'none' && solve.message) body.append(el('p', '', solve.message));
      if (solve.ellipse95Mm != null) body.append(el('p', '', t(pointNet, 'accuracy', { mm: solve.ellipse95Mm })));
      body.append(el('p', '', solve.seen.length ? t(pointNet, 'seen', { list: solve.seen.join(', ') }) : t(pointNet, 'seen_none')));
      break;
    }
  }
  return body;
}

function photoStatus(p: Photo): string {
  const of = p.originalFile;
  if (!of) return t(pointNet, 'photo_status_on_phone');
  if (of.uploadStatus === 'failed') return t(pointNet, 'photo_status_failed', { error: of.uploadError ?? '' });
  if (of.uploadStatus === 'verified') return t(pointNet, 'photo_status_onedrive');
  return t(pointNet, 'photo_status_uploading');
}

/** Photo strip on every step: tap any photo to view or retake it. */
function renderStrip(doc: GardenDocument, r: PointRun): HTMLElement {
  const strip = el('div', 'screen-strip');
  strip.dataset.testid = 'photo-strip';
  const photos = livePhotos(doc, r);
  if (!photos.length && r.type === 'photo') strip.append(el('span', 'screen-muted', t(pointNet, 'no_photos_yet')));
  photos.forEach((p, i) => {
    const b = btn('', 'screen-view-photo', { data: { photo: p.id }, testid: 'strip-thumb' });
    b.classList.add('screen-thumb');
    b.setAttribute('aria-label', `${i + 1}: ${photoStatus(p)}`);
    if (p.thumbnailDataUrl) {
      const img = el('img');
      img.src = p.thumbnailDataUrl;
      img.alt = '';
      b.append(img);
    } else b.textContent = String(i + 1);
    strip.append(b);
  });
  return strip;
}

function renderViewer(doc: GardenDocument, r: PointRun, photoId: string): HTMLElement {
  const sheet = el('section', 'screen-sheet screen-viewer');
  sheet.dataset.testid = 'photo-viewer';
  const p = doc.photos.find((x) => x.id === photoId);
  if (p?.thumbnailDataUrl) {
    const img = el('img', 'screen-viewer-img');
    img.src = p.thumbnailDataUrl;
    img.alt = '';
    sheet.append(img);
  }
  if (p) sheet.append(el('p', '', photoStatus(p)));
  sheet.append(el('p', 'screen-muted', t(pointNet, 'retake_help')));
  const row = el('div', 'screen-buttons');
  row.append(btn(t(pointNet, 'retake_btn'), 'screen-retake', { primary: true, data: { photo: photoId }, testid: 'viewer-retake', reason: r.photoIds.includes(photoId) ? null : t(pointNet, 'no_photos_yet') }));
  row.append(btn(t(pointNet, 'close_btn'), 'screen-close-viewer', { testid: 'viewer-close' }));
  sheet.append(row);
  return sheet;
}

// ------------------------------------------------------------------ commands

function num(text: string): number | undefined {
  const v = Number(text.replace(',', '.').trim());
  return text.trim() === '' || !Number.isFinite(v) ? undefined : v;
}

const FIELD_STEP: Record<string, string> = { northM: 'offsets', eastM: 'offsets', diagonalM: 'diagonal', separationM: 'post' };

function applyInput(input: HTMLInputElement): void {
  const field = input.dataset.field ?? '';
  if (!run || !FIELD_STEP[field]) return;
  const v = num(input.value);
  if ((run as unknown as Record<string, unknown>)[field] === v) return;
  run = edit(run, FIELD_STEP[field]!, { [field]: v } as Partial<PointRun>);
}

/** Typed values not yet stored (no change event yet) count when Next is tapped. */
function readLiveInputs(d: Document): void {
  for (const input of d.querySelectorAll<HTMLInputElement>('input[data-cmd="screen-input"]')) applyInput(input);
}

/** True when the command was a screen command. */
export function handleScreenCommand(cmd: string, source: HTMLElement): boolean {
  if (!cmd.startsWith('screen-') || !host) return false;
  const h = host;
  let doc = h.getDoc();
  notice = null;
  const value = source.dataset.value ?? '';
  const commitDoc = (next: GardenDocument) => {
    if (next !== doc) {
      doc = next;
      h.setDoc(next);
    }
  };
  switch (cmd) {
    case 'screen-start-point':
      run = newPointRun();
      screen = 'add-point';
      lastCentred = null;
      savedScroll = undefined;
      break;
    case 'screen-circle-test':
      h.openCircleTest();
      return true;
    case 'screen-type':
      if (run) run = edit(run, 'choose_type', { type: value as PointRun['type'] });
      break;
    case 'screen-from':
      if (run) run = edit(run, 'from_point', { from: value });
      break;
    case 'screen-post':
      if (run) run = edit(run, 'post', { twoSleeve: value === 'two', separationM: value === 'two' ? run.separationM ?? POST_SEPARATION_DEFAULT_M : run.separationM });
      break;
    case 'screen-layer':
      if (run) run = edit(run, 'layer', { layer: value as PhotoLayer });
      break;
    case 'screen-input': {
      // Change fires on blur, just before a tap on Next: store now, redraw after the tap lands.
      applyInput(source as HTMLInputElement);
      persist();
      window.setTimeout(() => h.rerender(), 0);
      return true;
    }
    case 'screen-next':
      readLiveInputs(source.ownerDocument);
      if (run) {
        const solve = run.type === 'photo' ? photoPointSolve(doc, run) : undefined;
        const moved = goNext(doc, run, solve);
        run = moved.run;
        if (moved.reason) notice = moved.reason;
      }
      break;
    case 'screen-back':
      if (run) run = goBack(run);
      break;
    case 'screen-save':
      if (run) {
        if (run.type === 'base') {
          const saved = saveBasePoint(doc, run);
          commitDoc(saved.doc);
          notice = t(pointNet, 'saved', { id: saved.id });
        } else {
          const solve = photoPointSolve(doc, run);
          commitDoc(savePhotoPoint(doc, run, solve));
          notice = t(pointNet, 'saved', { id: run.pointId ?? '' });
        }
        run = null;
        screen = 'home';
      }
      break;
    case 'screen-cancel':
      if (run) commitDoc(cancelRun(doc, run));
      run = null;
      screen = 'home';
      h.drainArchive();
      break;
    case 'screen-take-photo':
      if (run && run.type === 'photo') {
        const made = ensurePhotoPoint(doc, run);
        commitDoc(made.doc);
        run = made.run;
        const pointId = run.pointId!;
        h.takePhoto(pointId, (photoId) => {
          if (!run || run.pointId !== pointId) return;
          run = addRunPhoto(run, photoId);
          persist();
          h.rerender();
        });
      }
      break;
    case 'screen-view-photo':
      viewerPhotoId = source.dataset.photo ?? null;
      break;
    case 'screen-close-viewer':
      viewerPhotoId = null;
      break;
    case 'screen-retake':
      if (run && source.dataset.photo) {
        const r = retakePhoto(doc, run, source.dataset.photo);
        commitDoc(r.doc);
        run = r.run;
        viewerPhotoId = null;
        h.drainArchive();
        const pointId = run.pointId;
        if (pointId) {
          h.takePhoto(pointId, (photoId) => {
            if (!run || run.pointId !== pointId) return;
            run = addRunPhoto(run, photoId);
            persist();
            h.rerender();
          });
        }
      }
      break;
    case 'screen-dismiss-hint':
      if (run && source.dataset.hint) run = { ...run, dismissedHints: [...run.dismissedHints, source.dataset.hint] };
      break;
    default:
      return false;
  }
  persist();
  h.rerender();
  return true;
}

/** For tests: is a finger on the wheel. */
export function wheelTouching(): boolean {
  return touching();
}

void WHEEL_ROWS;
