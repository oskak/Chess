/**
 * Sound Effects via Web Audio API
 *
 * No external audio files needed - all sounds are synthesized.
 */

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 0.5;
    }

    _ensureContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    _createGain(volume) {
        const ctx = this._ensureContext();
        const gain = ctx.createGain();
        gain.gain.value = volume * this.volume;
        gain.connect(ctx.destination);
        return gain;
    }

    /**
     * Play a standard piece move sound (wooden thud).
     */
    playMove() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        // Create a short "thud" using filtered noise + tone
        const duration = 0.08;

        // Noise component (wooden character)
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        // Bandpass filter for wood-like sound
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        filter.Q.value = 1.5;

        const gain = this._createGain(0.4);
        noise.connect(filter);
        filter.connect(gain);

        // Tonal component
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + duration);
        const oscGain = this._createGain(0.15);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(oscGain);

        noise.start(now);
        noise.stop(now + duration);
        osc.start(now);
        osc.stop(now + duration);
    }

    /**
     * Play a capture sound (sharper, louder).
     */
    playCapture() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        const duration = 0.12;

        // Noise burst
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 0.8;

        const gain = this._createGain(0.6);
        noise.connect(filter);
        filter.connect(gain);

        // Impact tone
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + duration);
        const oscGain = this._createGain(0.2);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(oscGain);

        noise.start(now);
        noise.stop(now + duration);
        osc.start(now);
        osc.stop(now + duration);
    }

    /**
     * Play a correct move chime (pleasant ascending tone).
     */
    playCorrect() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        // Two ascending notes
        const notes = [523.25, 659.25]; // C5, E5
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const gain = this._createGain(0.2);
            gain.gain.setValueAtTime(0, now + i * 0.08);
            gain.gain.linearRampToValueAtTime(0.2 * this.volume, now + i * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);

            osc.connect(gain);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.25);
        });
    }

    /**
     * Play an error/wrong move sound (descending buzz).
     */
    playError() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.2);

        const gain = this._createGain(0.1);
        gain.gain.setValueAtTime(0.1 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.3);
    }

    /**
     * Play line complete / success fanfare.
     */
    playSuccess() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        // Three ascending notes: C5, E5, G5
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const gain = this._createGain(0.18);
            gain.gain.setValueAtTime(0, now + i * 0.1);
            gain.gain.linearRampToValueAtTime(0.18 * this.volume, now + i * 0.1 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.35);

            osc.connect(gain);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.4);
        });
    }

    /**
     * Play a transposition notification (subtle bell).
     */
    playTransposition() {
        if (!this.enabled) return;
        const ctx = this._ensureContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 880; // A5

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 1318.5; // E6

        const gain = this._createGain(0.08);
        gain.gain.setValueAtTime(0.08 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        osc2.connect(gain);
        osc.start(now);
        osc2.start(now);
        osc.stop(now + 0.5);
        osc2.stop(now + 0.5);
    }

    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
    }
}

window.SoundEngine = SoundEngine;
