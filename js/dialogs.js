/**
 * In-app modal dialogs and toasts.
 *
 * Replaces window.prompt / confirm / alert, which look out of place and —
 * in the Electron desktop app — prompt() is not supported at all (it throws),
 * which used to break "New Repertoire", pawn promotion and sandbox saving.
 *
 * Every dialog returns a Promise. Dialogs are queued: opening one while
 * another is visible waits for the first to close.
 */

class Dialogs {
    static _queue = Promise.resolve();

    static _escape(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    /**
     * Low-level: show a modal with arbitrary body HTML.
     * @param {Object} opts
     * @param {string} opts.title
     * @param {string} opts.bodyHtml
     * @param {Array<{label, value, kind?: 'primary'|'secondary'|'danger', submit?: boolean}>} opts.buttons
     * @param {*} opts.cancelValue - resolved on Escape / backdrop click
     * @param {Function} [opts.onOpen] - (modalEl, close) => void
     * @param {Function} [opts.collect] - (modalEl, buttonValue) => value to resolve, or
     *        undefined to keep the dialog open (validation failed)
     * @param {string} [opts.className]
     */
    static show(opts) {
        const run = () => new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            const titleId = 'modal-title-' + Math.random().toString(36).slice(2, 8);
            const buttonsHtml = (opts.buttons || []).map((b, i) =>
                `<button type="button" class="btn ${b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger-solid' : 'btn-secondary'}" data-idx="${i}">${Dialogs._escape(b.label)}</button>`
            ).join('');
            backdrop.innerHTML = `
                <div class="modal ${opts.className || ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                    ${opts.title ? `<h3 class="modal-title" id="${titleId}">${Dialogs._escape(opts.title)}</h3>` : ''}
                    <div class="modal-body">${opts.bodyHtml || ''}</div>
                    ${buttonsHtml ? `<div class="modal-actions">${buttonsHtml}</div>` : ''}
                </div>`;

            const previouslyFocused = document.activeElement;
            let closed = false;
            const close = (value) => {
                if (closed) return;
                closed = true;
                document.removeEventListener('keydown', onKey, true);
                backdrop.classList.add('closing');
                setTimeout(() => backdrop.remove(), 120);
                if (previouslyFocused && previouslyFocused.focus) {
                    try { previouslyFocused.focus(); } catch (e) { /* ignore */ }
                }
                resolve(value);
            };

            const modal = backdrop.querySelector('.modal');
            const submitWith = (button) => {
                const value = opts.collect ? opts.collect(modal, button.value) : button.value;
                if (value === undefined) return; // validation kept it open
                close(value);
            };

            backdrop.addEventListener('mousedown', (e) => {
                if (e.target === backdrop) close(opts.cancelValue);
            });
            backdrop.querySelectorAll('.modal-actions button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const b = opts.buttons[Number(btn.dataset.idx)];
                    if (b.value === opts.cancelValue && !b.submit) close(opts.cancelValue);
                    else submitWith(b);
                });
            });

            const onKey = (e) => {
                if (opts.onKey && opts.onKey(e, close)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close(opts.cancelValue);
                } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                    const def = (opts.buttons || []).find(b => b.submit);
                    if (def) {
                        e.preventDefault();
                        e.stopPropagation();
                        submitWith(def);
                    }
                } else if (e.key === 'Tab') {
                    // Keep focus inside the dialog
                    const focusables = [...modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
                        .filter(el => !el.disabled);
                    if (focusables.length === 0) return;
                    const first = focusables[0], last = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
                // Swallow app shortcuts (f, e, m, arrows...) while a dialog is open
                e.stopPropagation();
            };
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(backdrop);
            if (opts.onOpen) opts.onOpen(modal, close);
            const focusTarget = modal.querySelector('[autofocus]') || modal.querySelector('input, select, textarea')
                || modal.querySelector('.modal-actions .btn-primary') || modal.querySelector('button');
            if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
        });

        const result = Dialogs._queue.then(run);
        Dialogs._queue = result.catch(() => {});
        return result;
    }

    /** Informational message. */
    static alert(message, { title = 'Notice', okText = 'OK' } = {}) {
        return Dialogs.show({
            title,
            bodyHtml: `<p class="modal-text">${Dialogs._escape(message)}</p>`,
            buttons: [{ label: okText, value: true, kind: 'primary', submit: true }],
            cancelValue: true
        }).then(() => undefined);
    }

    /** Yes/no question. Resolves true/false. */
    static confirm(message, { title = 'Confirm', okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
        return Dialogs.show({
            title,
            bodyHtml: `<p class="modal-text">${Dialogs._escape(message)}</p>`,
            buttons: [
                { label: cancelText, value: false },
                { label: okText, value: true, kind: danger ? 'danger' : 'primary', submit: true }
            ],
            cancelValue: false
        });
    }

    /**
     * Pick one of several options. Resolves the chosen value or null.
     * @param {Array<{label, value, kind?, description?}>} choices
     */
    static choose(message, { title = 'Choose', choices = [], cancelText = 'Cancel' } = {}) {
        const desc = choices.filter(c => c.description).map(c =>
            `<li><strong>${Dialogs._escape(c.label)}</strong> — ${Dialogs._escape(c.description)}</li>`).join('');
        return Dialogs.show({
            title,
            bodyHtml: `<p class="modal-text">${Dialogs._escape(message)}</p>${desc ? `<ul class="modal-list">${desc}</ul>` : ''}`,
            buttons: [
                { label: cancelText, value: null },
                ...choices.map((c, i) => ({ label: c.label, value: c.value, kind: c.kind || (i === choices.length - 1 ? 'primary' : 'secondary'), submit: i === choices.length - 1 }))
            ],
            cancelValue: null
        });
    }

    /** Single text input. Resolves the trimmed string or null. */
    static prompt(message, { title = 'Input', defaultValue = '', placeholder = '', okText = 'OK', required = true } = {}) {
        return Dialogs.form({
            title,
            description: message,
            okText,
            fields: [{ name: 'value', type: 'text', value: defaultValue, placeholder, required }]
        }).then(r => (r ? r.value : null));
    }

    /**
     * Small form. Field types: text, select, color (White/Black segmented).
     * Resolves {name: value} or null.
     */
    static form({ title, description = '', fields = [], okText = 'OK', cancelText = 'Cancel' }) {
        const fieldHtml = fields.map((f, i) => {
            const id = `modal-field-${i}`;
            const label = f.label ? `<label for="${id}">${Dialogs._escape(f.label)}</label>` : '';
            if (f.type === 'select') {
                const opts = (f.options || []).map(o =>
                    `<option value="${Dialogs._escape(o.value)}"${o.value === f.value ? ' selected' : ''}>${Dialogs._escape(o.label)}</option>`).join('');
                return `<div class="form-group">${label}<select id="${id}" data-name="${f.name}">${opts}</select></div>`;
            }
            if (f.type === 'color') {
                const v = f.value === 'black' ? 'black' : 'white';
                return `<div class="form-group">${label}
                    <div class="segmented" data-name="${f.name}" data-value="${v}" role="radiogroup">
                        <button type="button" class="segment${v === 'white' ? ' selected' : ''}" data-value="white" role="radio" aria-checked="${v === 'white'}">&#9812; White</button>
                        <button type="button" class="segment${v === 'black' ? ' selected' : ''}" data-value="black" role="radio" aria-checked="${v === 'black'}">&#9818; Black</button>
                    </div></div>`;
            }
            return `<div class="form-group">${label}<input id="${id}" type="text" data-name="${f.name}" value="${Dialogs._escape(f.value || '')}" placeholder="${Dialogs._escape(f.placeholder || '')}" ${f.required ? 'data-required="1"' : ''} ${i === 0 ? 'autofocus' : ''}></div>`;
        }).join('');

        return Dialogs.show({
            title,
            bodyHtml: `${description ? `<p class="modal-text">${Dialogs._escape(description)}</p>` : ''}${fieldHtml}<div class="modal-error" aria-live="polite"></div>`,
            buttons: [
                { label: cancelText, value: null },
                { label: okText, value: 'ok', kind: 'primary', submit: true }
            ],
            cancelValue: null,
            onOpen: (modal) => {
                modal.querySelectorAll('.segmented').forEach(group => {
                    group.querySelectorAll('.segment').forEach(seg => {
                        seg.addEventListener('click', () => {
                            group.dataset.value = seg.dataset.value;
                            group.querySelectorAll('.segment').forEach(s => {
                                s.classList.toggle('selected', s === seg);
                                s.setAttribute('aria-checked', String(s === seg));
                            });
                        });
                    });
                });
                const first = modal.querySelector('input[type="text"]');
                if (first) setTimeout(() => first.select(), 0);
            },
            collect: (modal, buttonValue) => {
                if (buttonValue !== 'ok') return null;
                const out = {};
                for (const el of modal.querySelectorAll('[data-name]')) {
                    const name = el.dataset.name;
                    if (el.classList.contains('segmented')) out[name] = el.dataset.value;
                    else out[name] = el.value.trim();
                    if (el.dataset.required && !out[name]) {
                        modal.querySelector('.modal-error').textContent = 'Please fill in this field.';
                        el.focus();
                        return undefined;
                    }
                }
                return out;
            }
        });
    }

    /**
     * Graphical promotion picker.
     * @param {'w'|'b'} color
     * @returns {Promise<'q'|'r'|'b'|'n'|null>}
     */
    static promotion(color) {
        const pieces = ['q', 'r', 'b', 'n'];
        const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
        const img = (p) => (typeof getPieceImageUrl === 'function') ? getPieceImageUrl(color + p.toUpperCase()) : '';
        const body = `<div class="promo-choices">${pieces.map((p, i) =>
            `<button type="button" class="promo-choice" data-piece="${p}" title="${names[p]} (${p.toUpperCase()})" ${i === 0 ? 'autofocus' : ''}>
                <img src="${img(p)}" alt="${names[p]}"><span>${names[p]}</span></button>`).join('')}</div>`;
        return Dialogs.show({
            title: 'Promote pawn to',
            bodyHtml: body,
            className: 'modal-promotion',
            buttons: [],
            cancelValue: null,
            onOpen: (modal, close) => {
                modal.querySelectorAll('.promo-choice').forEach(btn => {
                    btn.addEventListener('click', () => close(btn.dataset.piece));
                });
            },
            // Q / R / B / N keyboard shortcuts
            onKey: (e, close) => {
                const k = (e.key || '').toLowerCase();
                if (!e.ctrlKey && !e.metaKey && !e.altKey && pieces.includes(k)) {
                    close(k);
                    return true;
                }
                return false;
            }
        });
    }

    /**
     * Non-blocking notification.
     * @param {string} message
     * @param {'info'|'success'|'error'|'warning'} type
     */
    static toast(message, type = 'info', durationMs = 2600) {
        let host = document.getElementById('toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toast-host';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        // Keep at most three visible: drop the oldest
        const visible = [...host.querySelectorAll('.toast:not(.leaving)')];
        while (visible.length >= 3) visible.shift().remove();

        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 250);
        }, durationMs);
        return el;
    }
}

window.Dialogs = Dialogs;
