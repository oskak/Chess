/**
 * Board overlay: SVG arrows drawn on top of a chessboard.js board.
 *
 * The overlay is positioned over the squares area (measured from the square
 * elements, so it is correct regardless of borders, notation or board size)
 * and never intercepts pointer events, so dragging pieces keeps working.
 */

class BoardOverlay {
    static COLORS = {
        green: '#15781b',   // repertoire mainline / correct move
        paleGreen: '#4f9a54', // repertoire alternatives
        blue: '#1c5fc4',    // engine best move
        red: '#b72222',     // mistake
        orange: '#d98b14'   // hint
    };

    /**
     * @param {string} containerId - the element chessboard.js was created in
     * @param {Function} getOrientation - () => 'white'|'black'
     */
    constructor(containerId, getOrientation) {
        this.container = document.getElementById(containerId);
        this.getOrientation = getOrientation;
        this.arrows = [];
        this.svg = null;
        this._ensureSvg();
    }

    _ensureSvg() {
        if (!this.container) return;
        if (this.svg && this.svg.isConnected) return;
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'board-overlay');
        svg.setAttribute('viewBox', '0 0 800 800');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = '<defs></defs><g class="arrows"></g>';
        this.container.appendChild(svg);
        this.svg = svg;
    }

    /** Place the SVG exactly over the 8x8 squares. */
    _fit() {
        this._ensureSvg();
        if (!this.svg) return false;
        const a8 = this.container.querySelector('.square-a8');
        const h1 = this.container.querySelector('.square-h1');
        if (!a8 || !h1) return false;
        const base = this.container.getBoundingClientRect();
        const r1 = a8.getBoundingClientRect();
        const r2 = h1.getBoundingClientRect();
        const left = Math.min(r1.left, r2.left) - base.left;
        const top = Math.min(r1.top, r2.top) - base.top;
        const right = Math.max(r1.right, r2.right) - base.left;
        const bottom = Math.max(r1.bottom, r2.bottom) - base.top;
        if (right - left < 8) return false; // board hidden
        Object.assign(this.svg.style, {
            left: left + 'px', top: top + 'px',
            width: (right - left) + 'px', height: (bottom - top) + 'px'
        });
        return true;
    }

    /** Centre of a square in the 800x800 viewBox, honouring orientation. */
    _center(square) {
        const file = square.charCodeAt(0) - 97; // a=0
        const rank = parseInt(square[1], 10) - 1; // 1=0
        const flipped = this.getOrientation() === 'black';
        const col = flipped ? 7 - file : file;
        const row = flipped ? rank : 7 - rank;
        return { x: col * 100 + 50, y: row * 100 + 50 };
    }

    /**
     * Replace all arrows.
     * @param {Array<{from, to, color?, opacity?, width?}>} arrows
     */
    setArrows(arrows) {
        this.arrows = (arrows || []).filter(a => a && /^[a-h][1-8]$/.test(a.from) && /^[a-h][1-8]$/.test(a.to) && a.from !== a.to);
        this.redraw();
    }

    clear() {
        this.setArrows([]);
    }

    redraw() {
        if (!this._fit()) {
            // Board not laid out yet (hidden view) — try again shortly.
            if (this.arrows.length) setTimeout(() => this._fit() && this._draw(), 60);
            return;
        }
        this._draw();
    }

    _draw() {
        const defs = this.svg.querySelector('defs');
        const g = this.svg.querySelector('g.arrows');
        const colors = [...new Set(this.arrows.map(a => a.color || BoardOverlay.COLORS.green))];
        defs.innerHTML = colors.map((c, i) =>
            `<marker id="ah-${i}" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('');

        g.innerHTML = this.arrows.map(a => {
            const color = a.color || BoardOverlay.COLORS.green;
            const mi = colors.indexOf(color);
            const p1 = this._center(a.from);
            const p2 = this._center(a.to);
            const width = a.width || 15;
            // Stop short of the target centre so the head sits inside the square
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            const shorten = width * 1.9;
            const x2 = p2.x - dx / len * shorten;
            const y2 = p2.y - dy / len * shorten;
            return `<line x1="${p1.x}" y1="${p1.y}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
                stroke="${color}" stroke-width="${width}" stroke-linecap="round"
                opacity="${a.opacity == null ? 0.8 : a.opacity}" marker-end="url(#ah-${mi})"/>`;
        }).join('');
    }
}

window.BoardOverlay = BoardOverlay;
