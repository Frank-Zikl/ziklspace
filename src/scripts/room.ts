import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createRoomMovement, type RoomPoint } from './room-movement';
import {
  roomClient,
  viewer,
  loadRoomEntries,
  saveRoomEntry,
  rewriteSticky,
  loadRevisions,
  login,
  LoginRateLimitError,
  type RoomEntry,
} from '../lib/room-api';

const root = document.querySelector<HTMLElement>('[data-personal-room]');
if (root) initializeRoom(root);

function initializeRoom(root: HTMLElement) {
  const find = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const all = <T extends HTMLElement>(selector: string) => [
    ...root.querySelectorAll<T>(selector),
  ];
  const status = find('[data-room-status]');
  const dialogs = all<HTMLDialogElement>('dialog[data-dialog]');
  let entries: RoomEntry[] = [];
  let owner = false;
  let generation = 0;
  let returnFocus: HTMLElement | null = null;
  let stickyEdit: RoomEntry | undefined;
  let tearing = false;
  let thoughtEdit: RoomEntry | undefined;
  let reading: RoomEntry | undefined;
  const linkedThought = new URL(window.location.href).searchParams.get(
    'thought',
  );
  let openedLinkedThought = false;
  const message = (error: unknown) =>
    error instanceof Error ? error.message : '操作失败，请稍后重试。';
  const say = (text: string) => {
    status.textContent = text;
  };
  let movement: ReturnType<typeof createRoomMovement> | undefined;
  const ownerOnly = new Set(['inbox', 'thought-editor']);
  function openPanel(id: string, opener?: HTMLElement) {
    if (ownerOnly.has(id) && !owner) id = 'account';
    const panel = dialogs.find((dialog) => dialog.dataset.dialog === id);
    if (!panel) return;
    movement?.cancel();
    if (opener) returnFocus = opener;
    dialogs.forEach((dialog) => {
      if (dialog.open && dialog !== panel) dialog.close();
    });
    if (!panel.open) panel.showModal();
  }
  all<HTMLButtonElement>('[data-open]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.classList.contains('room-hotspot'))
        approach(button, () => openPanel(button.dataset.open!, button));
      else openPanel(button.dataset.open!, button);
    }),
  );
  dialogs.forEach((dialog) => {
    dialog
      .querySelector('[data-close]')
      ?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (dialogs.some((panel) => panel.open)) return;
      const active = document.activeElement;
      // A native dialog may restore focus before dispatching its delayed close
      // event. Respect any newer scene/entry focus instead of stealing it back.
      if (
        active instanceof HTMLElement &&
        (scene.contains(active) || (!entry.hidden && entry.contains(active))) &&
        active.getClientRects().length > 0 &&
        !active.closest('[inert]')
      ) {
        return;
      }
      if (!entry.hidden) {
        find<HTMLButtonElement>('[data-enter]').focus({ preventScroll: true });
      } else if (
        returnFocus?.isConnected &&
        returnFocus.getClientRects().length
      ) {
        returnFocus.focus({ preventScroll: true });
      } else {
        scene.focus({ preventScroll: true });
      }
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        dialog.close();
    });
  });

  // The door only remembers a visit, never writing permission or content.
  const entry = find('[data-entry]');
  const scene = find('[data-room-stage]');
  const surroundings = [scene];
  const viewport = find<HTMLElement>('.room-viewport');
  const world = find<HTMLElement>('.room-world');
  const sceneWidth = Number(world.dataset.sceneWidth) || 960;
  const sceneHeight = Number(world.dataset.sceneHeight) || 640;
  let cameraReady = false;
  let cameraX = 0.5;
  let cameraY = 0;
  let previousRangeX = 0;
  let previousRangeY = 0;
  const clamp = (value: number, maximum: number) =>
    Math.max(0, Math.min(maximum, value));
  const frameRoom = () => {
    const rangeX = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const rangeY = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (!cameraReady) {
      cameraX = rangeX
        ? clamp(
            world.offsetLeft +
              world.offsetWidth * 0.5 -
              viewport.clientWidth / 2,
            rangeX,
          ) / rangeX
        : 0.5;
      cameraY = rangeY
        ? clamp(
            world.offsetTop +
              world.offsetHeight * (440 / 640) -
              viewport.clientHeight * 0.78,
            rangeY,
          ) / rangeY
        : 0;
      cameraReady = true;
    }
    viewport.scrollTo({
      left: rangeX * cameraX,
      top: rangeY * cameraY,
      behavior: 'instant',
    });
    previousRangeX = rangeX;
    previousRangeY = rangeY;
  };
  const cameraObserver = new ResizeObserver(frameRoom);
  cameraObserver.observe(viewport);
  cameraObserver.observe(world);
  viewport.addEventListener(
    'scroll',
    () => {
      const rangeX = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const rangeY = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (rangeX && rangeX === previousRangeX)
        cameraX = viewport.scrollLeft / rangeX;
      if (rangeY && rangeY === previousRangeY)
        cameraY = viewport.scrollTop / rangeY;
    },
    { passive: true },
  );
  function followCharacter(point: RoomPoint, moving: boolean) {
    if (!moving) return;
    const x = world.offsetLeft + (point.x / sceneWidth) * world.offsetWidth;
    const y = world.offsetTop + (point.y / sceneHeight) * world.offsetHeight;
    let left = viewport.scrollLeft;
    let top = viewport.scrollTop;
    if (x < left + viewport.clientWidth * 0.22)
      left = x - viewport.clientWidth * 0.22;
    if (x > left + viewport.clientWidth * 0.78)
      left = x - viewport.clientWidth * 0.78;
    if (y < top + viewport.clientHeight * 0.28)
      top = y - viewport.clientHeight * 0.28;
    if (y > top + viewport.clientHeight * 0.82)
      top = y - viewport.clientHeight * 0.82;
    viewport.scrollTo({ left, top, behavior: 'instant' });
  }
  movement = createRoomMovement({
    world,
    avatar: find('[data-room-avatar]'),
    target: find('[data-walk-target]'),
    width: sceneWidth,
    height: sceneHeight,
    bounds: { x: 32, y: 280, width: 896, height: 328 },
    obstacles: [
      { x: 384, y: 256, width: 280, height: 80 },
      { x: 784, y: 248, width: 128, height: 72 },
      { x: 72, y: 416, width: 200, height: 136 },
      { x: 776, y: 464, width: 112, height: 80 },
      { x: 672, y: 280, width: 88, height: 56 },
    ],
    clearance: 8,
    start: { x: 480, y: 440 },
    onUpdate: followCharacter,
  });
  function approach(button: HTMLElement, action: () => void) {
    const x = Number(button.dataset.walkX);
    const y = Number(button.dataset.walkY);
    if (!movement || !Number.isFinite(x) || !Number.isFinite(y)) {
      action();
      return;
    }
    void movement.walkTo({ x, y }, { onArrival: action });
  }
  let pointerFocusTarget: HTMLElement | null = null;
  let pointerFocusTimer: number | undefined;
  let gesture: {
    x: number;
    y: number;
    left: number;
    top: number;
    dragged: boolean;
  } | null = null;
  const clearPointerFocus = () => {
    window.clearTimeout(pointerFocusTimer);
    pointerFocusTarget = null;
  };
  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      window.clearTimeout(pointerFocusTimer);
      pointerFocusTarget = (event.target as HTMLElement).closest<HTMLElement>(
        '.room-hotspot',
      );
      gesture = {
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        dragged: false,
      };
    },
    { capture: true },
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      if (
        gesture &&
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8
      )
        gesture.dragged = true;
    },
    { passive: true },
  );
  window.addEventListener(
    'pointerup',
    () => {
      pointerFocusTimer = window.setTimeout(clearPointerFocus, 0);
    },
    { capture: true },
  );
  window.addEventListener(
    'pointercancel',
    () => {
      if (gesture) gesture.dragged = true;
      clearPointerFocus();
    },
    { capture: true },
  );
  window.addEventListener('blur', () => {
    clearPointerFocus();
    movement?.cancel();
  });
  viewport.addEventListener('keydown', (event) => {
    clearPointerFocus();
    if (event.key === 'Escape') movement?.cancel();
  });
  viewport.addEventListener(
    'click',
    (event) => {
      if (
        event.detail &&
        gesture &&
        (gesture.dragged ||
          Math.hypot(
            viewport.scrollLeft - gesture.left,
            viewport.scrollTop - gesture.top,
          ) > 8)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  viewport.addEventListener('click', (event) => {
    if (
      !(event.target as HTMLElement).closest('.room-world') ||
      (event.target as HTMLElement).closest('.room-hotspot') ||
      !entry.hidden ||
      dialogs.some((dialog) => dialog.open)
    )
      return;
    void movement?.walkTo(
      movement.fromClientPoint(event.clientX, event.clientY),
    );
  });
  viewport.addEventListener('focusin', (event) => {
    const object = (event.target as HTMLElement).closest<HTMLElement>(
      '.room-hotspot',
    );
    if (!object || object === pointerFocusTarget) return;
    object.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
  });
  let entering = false;
  let entryTimer: number | undefined;
  const finishEnteringRoom = () => {
    window.clearTimeout(entryTimer);
    entry.hidden = true;
    surroundings.forEach((element) => {
      element.inert = false;
    });
    scene.focus({ preventScroll: true });
    entering = false;
  };
  function showDoor() {
    movement?.cancel();
    window.clearTimeout(entryTimer);
    entering = false;
    entry.hidden = false;
    entry.classList.remove('entering');
    surroundings.forEach((element) => {
      element.inert = true;
    });
    find<HTMLButtonElement>('[data-enter]').focus({ preventScroll: true });
  }
  function enterRoom(skip = false) {
    if (entering) {
      if (skip) finishEnteringRoom();
      return;
    }
    entering = true;
    try {
      sessionStorage.setItem('zikl-room-visited', '1');
    } catch {
      /* Entry remains usable with storage disabled. */
    }
    entry.classList.add('entering');
    if (skip || matchMedia('(prefers-reduced-motion: reduce)').matches)
      finishEnteringRoom();
    else entryTimer = window.setTimeout(finishEnteringRoom, 800);
  }
  find('[data-enter]').addEventListener('click', () => enterRoom());
  find('[data-skip-entry]').addEventListener('click', () => enterRoom(true));
  find('[data-reenter]').addEventListener('click', () =>
    approach(find('[data-reenter]'), showDoor),
  );
  entry.setAttribute('role', 'dialog');
  entry.setAttribute('aria-modal', 'true');
  entry.setAttribute('aria-label', '房间入口');
  entry.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') enterRoom(true);
    if (event.key === 'Tab') {
      const first = find<HTMLButtonElement>('[data-enter]');
      const last = find<HTMLButtonElement>('[data-skip-entry]');
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  let visited = false;
  try {
    visited = sessionStorage.getItem('zikl-room-visited') === '1';
  } catch {
    /* Optional convenience only. */
  }
  if (!visited && !linkedThought) showDoor();

  const lamp = find<HTMLButtonElement>('[data-lamp]');
  lamp.addEventListener('click', () =>
    approach(lamp, () => {
      const night = document.body.classList.toggle('night');
      lamp.setAttribute('aria-pressed', String(night));
    }),
  );
  let catTimer: number | undefined;
  const cat = find('[data-cat]');
  cat.addEventListener('click', () =>
    approach(cat, () => {
      root.classList.add('cat-awake');
      say('喵。');
      clearTimeout(catTimer);
      catTimer = window.setTimeout(() => {
        root.classList.remove('cat-awake');
        say('');
      }, 1800);
    }),
  );

  all<HTMLButtonElement>('[data-read-book]').forEach((button) =>
    button.addEventListener('click', () => {
      find('[data-book-selection]').hidden = true;
      all('[data-book-reader]').forEach((reader) => {
        reader.hidden = reader.dataset.bookReader !== button.dataset.readBook;
      });
      const visible = all('[data-book-reader]').find(
        (reader) => !reader.hidden,
      );
      visible?.querySelector<HTMLButtonElement>('button')?.focus();
    }),
  );
  all<HTMLButtonElement>('[data-back-books]').forEach((button) =>
    button.addEventListener('click', () => {
      all('[data-book-reader]').forEach((reader) => {
        reader.hidden = true;
      });
      find('[data-book-selection]').hidden = false;
      find<HTMLButtonElement>('[data-read-book]')?.focus();
    }),
  );

  const boardInput = find<HTMLTextAreaElement>('[data-board-input]');
  let boardDirty = false;
  let boardBaseline: RoomEntry | undefined;
  boardInput.addEventListener('input', () => {
    if (!boardDirty)
      boardBaseline = entries.find((entry) => entry.kind === 'whiteboard');
    boardDirty = true;
  });
  const boardStatus = find('[data-board-status]');
  const stickyForm = find<HTMLFormElement>('[data-sticky-form]');
  const stickyInput = find<HTMLTextAreaElement>('[data-sticky-input]');
  const stickyStatus = find('[data-sticky-status]');
  function setOwner(value: boolean) {
    owner = value;
    root.dataset.owner = String(value);
    all('[data-owner-only]').forEach((element) => {
      element.hidden = !value;
    });
    boardInput.readOnly = !value;
    boardStatus.textContent = value ? '云端保存 · 访客可读' : '访客只读';
    const accountLabel = value ? '房主' : '房主登录';
    find('[data-account-label]').textContent = accountLabel;
    find('[data-open="account"]').setAttribute('aria-label', accountLabel);
    if (!value) stickyForm.hidden = true;
  }
  function applyEntry(entry: RoomEntry) {
    entries = [entry, ...entries.filter((item) => item.id !== entry.id)];
    renderEntries();
  }
  function renderEntries() {
    const whiteboard = entries.find((entry) => entry.kind === 'whiteboard');
    if (!boardDirty) boardInput.value = whiteboard?.body ?? '';
    find('[data-board-preview]').textContent =
      whiteboard?.body.split('\n')[0].slice(0, 40) || '';
    const notes = entries.filter((entry) => entry.kind === 'sticky');
    const active = notes.filter((entry) => entry.paper_state !== 'torn');
    const torn = notes.filter((entry) => entry.paper_state === 'torn');
    find('[data-sticky-count]').textContent = `${active.length} 张`;
    find('[data-bin-label]').textContent = `纸篓 · ${torn.length}`;
    find('[data-sticky-list]').replaceChildren(...active.map(stickyCard));
    find('[data-torn-list]').replaceChildren(...torn.map(stickyCard));
    const thoughts = entries.filter((entry) => entry.kind === 'thought');
    find('[data-thought-list]').replaceChildren(
      ...thoughts
        .filter((entry) => entry.status === 'published')
        .map(thoughtLink),
    );
    find('[data-draft-list]').replaceChildren(
      ...(owner
        ? thoughts.filter((entry) => entry.status === 'draft').map(thoughtLink)
        : []),
    );
  }
  function thoughtLink(entry: RoomEntry) {
    const button = document.createElement('button');
    button.type = 'button';
    const title = document.createElement('span');
    title.textContent = entry.title;
    const meta = document.createElement('small');
    meta.textContent = entry.status === 'draft' ? '草稿' : '↗';
    button.append(title, meta);
    button.addEventListener('click', () => void readThought(entry));
    return button;
  }
  function stickyCard(entry: RoomEntry) {
    const card = document.createElement('article');
    card.className = `sticky-card is-${entry.paper_state}`;
    card.dataset.noteId = entry.id;
    const text = document.createElement('p');
    text.textContent = entry.body;
    card.append(text);
    if (owner && entry.paper_state !== 'torn') {
      const actions = document.createElement('div');
      actions.className = 'sticky-actions';
      const action = (label: string, fn: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', fn);
        actions.append(button);
      };
      action('修改', () => editSticky(entry));
      if (entry.paper_state === 'active')
        action('划掉', () => {
          void perform(actions, stickyStatus, async () => {
            applyEntry(await saveRoomEntry({ paper_state: 'crossed' }, entry));
          });
        });
      action('撕下重写', () => editSticky(entry, true));
      card.append(actions);
    }
    const history = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '旧字迹';
    const revisions = document.createElement('div');
    history.append(summary, revisions);
    let loaded = false;
    history.addEventListener('toggle', async () => {
      if (!history.open || loaded) return;
      revisions.textContent = '读取中…';
      try {
        const records = await loadRevisions(entry.id);
        revisions.replaceChildren(
          ...records.map((record) => {
            const line = document.createElement('p');
            line.textContent = record.body;
            return line;
          }),
        );
        if (records.length === 0) revisions.textContent = '还没有旧字迹';
        loaded = true;
      } catch (error) {
        revisions.textContent = message(error);
      }
    });
    card.append(history);
    return card;
  }
  async function perform(
    container: HTMLElement,
    feedback: HTMLElement,
    action: () => Promise<void>,
  ) {
    if (!owner) {
      feedback.textContent = '请先以房主身份登录。';
      return;
    }
    const buttons = [
      ...container.querySelectorAll<
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
      >('button,input,textarea,select'),
    ];
    if (buttons.some((button) => button.disabled)) return;
    buttons.forEach((button) => {
      button.disabled = true;
    });
    feedback.textContent = '保存中…';
    try {
      await action();
      feedback.textContent = '已保存';
    } catch (error) {
      feedback.textContent = message(error);
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }
  find<HTMLFormElement>('[data-board-form]').addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      void perform(form, boardStatus, async () => {
        const existing = boardDirty
          ? boardBaseline
          : entries.find((entry) => entry.kind === 'whiteboard');
        const values = existing
          ? { body: boardInput.value }
          : {
              kind: 'whiteboard' as const,
              body: boardInput.value,
              status: 'published' as const,
            };
        const saved = await saveRoomEntry(values, existing);
        boardDirty = false;
        boardBaseline = undefined;
        applyEntry(saved);
      });
    },
  );
  function editSticky(entry?: RoomEntry, tear = false) {
    if (!owner) return;
    stickyEdit = entry;
    tearing = tear;
    stickyForm.hidden = false;
    stickyInput.value = tear ? '' : (entry?.body ?? '');
    find('[data-sticky-editor-label]').textContent = tear
      ? '重写 · 原便签将留在纸篓'
      : entry
        ? '修改 · 保留旧字迹'
        : '新便签';
    stickyStatus.textContent = '';
    stickyInput.focus();
  }
  find('[data-new-sticky]').addEventListener('click', () => editSticky());
  find('[data-cancel-sticky]').addEventListener('click', () => {
    stickyForm.hidden = true;
  });
  stickyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(stickyForm, stickyStatus, async () => {
      if (!stickyInput.value.trim()) throw new Error('写一点内容再贴上。');
      if (tearing && stickyEdit) {
        const replacement = await rewriteSticky(stickyEdit, stickyInput.value);
        entries = entries.map((entry) =>
          entry.id === stickyEdit!.id
            ? { ...entry, paper_state: 'torn' as const }
            : entry,
        );
        applyEntry(replacement);
      } else {
        applyEntry(
          await saveRoomEntry(
            stickyEdit
              ? { body: stickyInput.value }
              : {
                  kind: 'sticky',
                  body: stickyInput.value,
                  status: 'published',
                },
            stickyEdit,
          ),
        );
      }
      stickyForm.hidden = true;
    });
  });

  const thoughtForm = find<HTMLFormElement>('[data-thought-form]');
  const thoughtTitle = find<HTMLInputElement>('[data-thought-title]');
  const thoughtBody = find<HTMLTextAreaElement>('[data-thought-body]');
  const thoughtSource = find<HTMLSelectElement>('[data-thought-source]');
  function editThought(entry?: RoomEntry) {
    if (!owner) return;
    thoughtEdit = entry;
    thoughtTitle.value = entry?.title ?? '';
    thoughtBody.value = entry?.body ?? '';
    thoughtSource.value = entry?.source ?? 'manual';
    find('[data-thought-status]').textContent = '';
    thoughtForm.querySelector('button[type="submit"]')!.textContent =
      entry?.status === 'published' ? '保存修改' : '保存草稿';
    find<HTMLInputElement>('[data-import-markdown]').value = '';
    openPanel('thought-editor');
    thoughtTitle.focus();
  }
  find('[data-new-thought]').addEventListener('click', () => editThought());
  find('[data-edit-thought]').addEventListener('click', () =>
    editThought(reading),
  );
  find<HTMLInputElement>('[data-import-markdown]').addEventListener(
    'change',
    async (event) => {
      if (!owner) return;
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const feedback = find('[data-thought-status]');
      try {
        if (file.size > 120000)
          throw new Error('文件过大，请控制在 30,000 字以内。');
        const content = await file.text();
        if (content.length > 30000)
          throw new Error('文件过长，请控制在 30,000 字以内。');
        const heading = content.match(/^#\s+(.+)\r?\n/);
        thoughtTitle.value =
          heading?.[1].trim().slice(0, 200) ||
          file.name.replace(/\.(md|markdown)$/i, '').slice(0, 200);
        thoughtBody.value = heading
          ? content.slice(heading[0].length).trimStart()
          : content;
        feedback.textContent = '已导入，保存前可以继续修改。';
      } catch (error) {
        feedback.textContent = message(error);
      }
    },
  );
  thoughtForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(thoughtForm, find('[data-thought-status]'), async () => {
      if (!thoughtTitle.value.trim() || !thoughtBody.value.trim())
        throw new Error('请填写标题和正文。');
      const values = {
        title: thoughtTitle.value.trim(),
        body: thoughtBody.value,
        source: thoughtSource.value as RoomEntry['source'],
        status: thoughtEdit?.status ?? ('draft' as const),
      };
      const saved = await saveRoomEntry(
        thoughtEdit ? values : { ...values, kind: 'thought' },
        thoughtEdit,
      );
      applyEntry(saved);
      thoughtEdit = saved;
      await readThought(saved);
    });
  });
  async function readThought(entry: RoomEntry) {
    reading = entry;
    find('[data-thought-title-display]').textContent = entry.title;
    find('[data-thought-meta]').textContent =
      `${entry.status === 'draft' ? '草稿 · 仅自己可见' : '笔记'} / ${entry.source.toUpperCase()}`;
    const html = marked.parse(entry.body, { async: false });
    const content = find('[data-thought-content]');
    // Untrusted AI / imported Markdown cannot inject scripts, iframes or remote tracking images.
    content.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'img',
        'video',
        'audio',
        'iframe',
        'form',
        'input',
        'button',
        'style',
      ],
      FORBID_ATTR: ['style'],
    });
    content.querySelectorAll('a').forEach((link) => {
      link.rel = 'noopener noreferrer';
    });
    find('[data-publish-thought]').hidden =
      !owner || entry.status === 'published';
    find('[data-reader-status]').textContent = '';
    const permalink = find<HTMLAnchorElement>('[data-thought-permalink]');
    permalink.hidden = entry.status !== 'published';
    permalink.href = `/?thought=${encodeURIComponent(entry.id)}`;
    openPanel('thought');
  }
  find('[data-publish-thought]').addEventListener('click', (event) => {
    if (!reading) return;
    void perform(
      (event.currentTarget as HTMLElement).parentElement!,
      find('[data-reader-status]'),
      async () => {
        if (!reading || reading.status !== 'draft') return;
        const published = await saveRoomEntry({ status: 'published' }, reading);
        applyEntry(published);
        await readThought(published);
      },
    );
  });

  async function refresh() {
    const ticket = ++generation;
    if (!roomClient) {
      setOwner(false);
      renderEntries();
      find('[data-auth-status]').textContent =
        '尚未连接 Supabase。房间可浏览，云端登录和保存暂不可用。';
      return;
    }
    try {
      const [who, content] = await Promise.all([viewer(), loadRoomEntries()]);
      if (ticket !== generation) return;
      setOwner(who.owner);
      entries = content;
      renderEntries();
      find('[data-auth-status]').textContent = who.owner
        ? '已以房主身份登录。'
        : who.signedIn
          ? '此账号不是房主，只能阅读公开内容。'
          : '只有房主可以编辑。';
      find('[data-login-form]').hidden = who.signedIn;
      find('[data-signout]').hidden = !who.signedIn;
      say('');
      if (linkedThought && !openedLinkedThought) {
        openedLinkedThought = true;
        const linked = entries.find(
          (entry) => entry.id === linkedThought && entry.kind === 'thought',
        );
        if (linked) await readThought(linked);
        else say('这篇思考尚未公开或不存在');
      }
    } catch (error) {
      if (ticket !== generation) return;
      setOwner(false);
      entries = [];
      renderEntries();
      find('[data-auth-status]').textContent = message(error);
      find('[data-login-form]').hidden = false;
      say('云端内容暂时无法读取');
    }
  }
  const loginForm = find<HTMLFormElement>('[data-login-form]');
  const loginButton = loginForm.querySelector<HTMLButtonElement>('button')!;
  let loginCooldownUntil = 0;
  let loginCooldownTimer: number | undefined;
  function waitToResend(seconds: number) {
    window.clearInterval(loginCooldownTimer);
    loginCooldownUntil = Date.now() + seconds * 1000;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((loginCooldownUntil - Date.now()) / 1000),
      );
      loginButton.disabled = remaining > 0;
      loginButton.textContent = remaining
        ? `${remaining} 秒后可重发`
        : '发送登录链接';
      if (!remaining) window.clearInterval(loginCooldownTimer);
    };
    update();
    loginCooldownTimer = window.setInterval(update, 1000);
  }
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginButton.disabled) return;
    loginButton.disabled = true;
    try {
      await login(find<HTMLInputElement>('[data-login-email]').value.trim());
      find('[data-auth-status]').textContent =
        '登录邮件已发送，请检查收件箱和垃圾邮件，用同一浏览器打开最新链接。';
      waitToResend(60);
    } catch (error) {
      find('[data-auth-status]').textContent = message(error);
      if (error instanceof LoginRateLimitError)
        waitToResend(error.retryAfterSeconds);
    } finally {
      loginButton.disabled = Date.now() < loginCooldownUntil;
    }
  });
  function clearPrivateState() {
    boardDirty = false;
    boardBaseline = undefined;
    ++generation;
    setOwner(false);
    entries = [];
    renderEntries();
    reading = undefined;
    thoughtEdit = undefined;
    stickyEdit = undefined;
    thoughtForm.reset();
    stickyForm.reset();
    find('[data-thought-content]').replaceChildren();
    find('[data-thought-title-display]').textContent = '';
    dialogs.forEach((dialog) => {
      if (dialog.open) dialog.close();
    });
  }
  find('[data-signout]').addEventListener('click', async () => {
    const result = await roomClient?.auth.signOut();
    if (result?.error) {
      find('[data-auth-status]').textContent = '退出失败，请稍后重试。';
      return;
    }
    clearPrivateState();
    await refresh();
  });
  roomClient?.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearPrivateState();
    // Supabase callbacks must not await another auth operation inside their lock.
    window.setTimeout(() => {
      void refresh();
    }, 0);
  });
  void refresh();
}
