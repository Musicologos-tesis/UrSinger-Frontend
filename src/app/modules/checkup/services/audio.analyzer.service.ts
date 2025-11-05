import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

@Injectable({ providedIn: 'root' })
export class AudioAnalyzerService {
    private ctx?: AudioContext;
    private src?: MediaStreamAudioSourceNode;
    private analyser?: AnalyserNode;
    private stream?: MediaStream;
    private raf?: number;

    readonly level$ = new Subject<number>(); // 0..1 para animar el ícono

    async requestMic(deviceId?: string) {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            throw new Error('secure-context-required');
        }

        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        const track = this.stream?.getAudioTracks()[0];
        const label = track?.label ?? 'unknown';
        const deviceIdHash = await this.sha256Hex(label);

        this.ctx = new AudioContext();
        this.src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.src.connect(this.analyser);

        const buf = new Uint8Array(this.analyser.frequencyBinCount);
        const tick = () => {
            this.analyser!.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
                const v = (buf[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / buf.length);
            this.level$.next(rms);
            this.raf = requestAnimationFrame(tick);
        }

        this.raf = requestAnimationFrame(tick);

        const sampleRate = this.ctx.sampleRate;
        localStorage.setItem('ursinger.prep.sampleRate', String(sampleRate));
        localStorage.setItem('ursinger.prep.deviceHash', deviceIdHash);
        localStorage.setItem('ursinger.prep.sampleRate', String(this.ctx!.sampleRate));
        return { sampleRate: this.ctx!.sampleRate, deviceIdHash };
    }

    private async sha256Hex(s: string) {
        const data = new TextEncoder().encode(s);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
    }

    async listInputDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === 'audioinput');
    }

    stop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.stream?.getTracks().forEach(t => t.stop());
        this.ctx?.close();
        this.raf = undefined;
        this.stream = undefined;
        this.ctx = undefined;
        this.src = undefined;
        this.analyser = undefined;
    }

    getAnalyser() { return this.analyser; }

}