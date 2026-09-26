// SPDX-License-Identifier: MIT
import { CockpitInput } from './cockpit-input.ts';

interface Actions {
  input: CockpitInput;
  start(): void;
  stop(reason: string): void;
  motion(): void;
  recenter(): void;
  touch(): void;
}
const ids = ['joystick', 'throttle', 'brake', 'pause-flight',
  'reset-flight', 'motion-control', 'motion-recenter'];

/** Input owner for the dedicated drone shell; simulation is a separate page. */
export class CockpitControls {
  private pointer: number | null = null;
  private ready = false;
  private pending = false;
  private message = 'Tap Enable Motion or the joystick, then Start · motors disabled';
  private motionPhase = 'off';
  private bound: Array<[string, EventListener]> = [];
  constructor(private readonly actions: Actions) {
    for (const type of ['click', 'input', 'change', 'pointerdown', 'pointermove',
      'pointerup', 'pointercancel', 'lostpointercapture', 'keydown', 'keyup']) {
      const handler: EventListener = event => this.handle(event);
      document.addEventListener(type, handler, true); this.bound.push([type, handler]);
    }
  }
  attach() {
    for (const id of [...ids, 'joystick-knob', 'throttle-output', 'stage-status'])
      if (!document.getElementById(id)) throw new Error(`Missing cockpit control: ${id}`);
    this.ready = true;
    document.documentElement.dataset.wifiControls = 'bench';
    this.node<HTMLInputElement>('throttle').min = '0';
    this.node<HTMLInputElement>('throttle').max = '100';
    this.render();
  }
  private node<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id)! as T; }
  private handle(event: Event) {
    const target = event.target instanceof Element ? event.target.closest('[id]') : null;
    const id = target?.id === 'joystick-knob' ? 'joystick' : target?.id;
    if (!id || !ids.includes(id)) return;
    event.stopImmediatePropagation();
    if (!this.ready) { event.preventDefault(); return; }
    if (id === 'joystick') { this.joystick(event); return; }
    if (id === 'throttle') {
      if (event.type === 'input' || event.type === 'change') {
        try { this.actions.input.setThrottle(this.node<HTMLInputElement>(id).valueAsNumber / 100); }
        catch { this.actions.stop('Invalid throttle'); }
        this.render();
      } else if (event.type === 'pointercancel') this.actions.stop('Throttle touch cancelled');
      return; // Keep native range keyboard and pointer behavior.
    }
    if (id === 'brake' && (event.type === 'pointerdown' || event.type === 'click')) {
      event.preventDefault(); this.actions.stop('BRAKE · session stopped'); return;
    }
    if (event.type !== 'click') return;
    event.preventDefault();
    if (id === 'pause-flight') {
      if (this.actions.input.active || this.pending) this.actions.stop('Paused by operator');
      else this.actions.start();
    } else if (id === 'reset-flight') this.actions.stop('Reset · inputs zeroed');
    else if (id === 'motion-control') this.actions.motion();
    else if (id === 'motion-recenter') this.actions.recenter();
  }
  private joystick(event: Event) {
    const stick = this.node('joystick');
    if (event instanceof KeyboardEvent) {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') { this.actions.stop('Joystick cancelled'); return; }
      if (event.type === 'keydown') {
        this.actions.touch();
        this.actions.input.steer(event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0,
          event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
      } else this.actions.input.steer(0, 0);
    } else if (event instanceof PointerEvent) {
      event.preventDefault();
      if (event.type === 'pointerdown') {
        if (this.pointer !== null) return;
        this.actions.touch(); this.pointer = event.pointerId;
        stick.setPointerCapture(event.pointerId);
      }
      if (this.pointer !== event.pointerId) return;
      if (event.type === 'pointerup') {
        this.pointer = null; this.actions.input.steer(0, 0);
        if (stick.hasPointerCapture(event.pointerId)) stick.releasePointerCapture(event.pointerId);
      } else if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        this.pointer = null; this.actions.stop('Joystick touch cancelled');
      } else if (event.type === 'pointerdown' || event.type === 'pointermove') {
        const box = stick.getBoundingClientRect();
        this.actions.input.steer((event.clientX - box.left) / (box.width / 2) - 1,
          (event.clientY - box.top) / (box.height / 2) - 1);
      }
    }
    this.render();
  }
  report(message: string, active: boolean, pending = false) {
    this.message = message; this.pending = pending; this.actions.input.active = active;
    if (!active) {
      this.actions.input.clear();
      const pointer = this.pointer; this.pointer = null;
      if (this.ready && pointer !== null && this.node('joystick').hasPointerCapture(pointer))
        this.node('joystick').releasePointerCapture(pointer);
    }
    this.render();
  }
  motionState(phase: string) { this.motionPhase = phase; this.render(); }
  telemetry(text: string, seq?: number) {
    const el = document.querySelector('[data-main-imu]'); if (el) el.textContent = text;
    this.render();
    if (this.ready) this.node('telemetry-imu').textContent = seq === undefined ? '—' : String(seq);
  }
  ack(text: string) { const el = document.querySelector('[data-main-ack]'); if (el) el.textContent = text; }
  render() {
    if (!this.ready) return;
    const input = this.actions.input;
    const throttle = this.node<HTMLInputElement>('throttle');
    throttle.disabled = !input.active; throttle.value = String(Math.round(input.throttle * 100));
    this.node('throttle-output').textContent = `${throttle.value}%`;
    this.node('telemetry-throttle').textContent = `${throttle.value}%`;
    this.node('telemetry-yaw').textContent = '0';
    this.node('telemetry-motors').textContent = 'OFF';
    this.node('pause-flight').textContent = input.active ? 'Pause' : this.pending ? 'Cancel' : 'Start';
    this.node<HTMLButtonElement>('pause-flight').disabled = false;
    this.node('pause-flight').setAttribute('aria-label', input.active ? 'Pause Wi-Fi bench control' : this.pending ? 'Cancel connection' : 'Start Wi-Fi bench control');
    this.node('stage-status').textContent = `${input.mode === 'motion' ? 'Motion' : 'Touch'} · ${this.message}`;
    this.node('runtime-phase').textContent = input.active ? 'BENCH ACTIVE' : 'BENCH STOPPED';
    this.node('joystick').setAttribute('aria-disabled', 'false');
    this.node('joystick').tabIndex = 0;
    this.node('joystick').setAttribute('aria-valuetext', `Roll ${input.roll.toFixed(2)}, pitch ${input.pitch.toFixed(2)}`);
    const radius = this.node('joystick').getBoundingClientRect().width * .31;
    this.node('joystick-knob').style.transform = `translate(calc(-50% + ${input.roll * radius}px), calc(-50% - ${input.pitch * radius}px))`;
    const enabled = ['running', 'calibrating'].includes(this.motionPhase);
    this.node('motion-control').textContent = enabled ? 'Disable Motion' : 'Enable Motion';
    this.node('motion-control').setAttribute('aria-pressed', String(enabled));
    this.node<HTMLButtonElement>('motion-control').disabled = this.motionPhase === 'requesting-permission';
    this.node('motion-recenter').hidden = this.motionPhase !== 'running';
    this.node<HTMLButtonElement>('brake').disabled = false;
  }
  dispose() { for (const [type, handler] of this.bound) document.removeEventListener(type, handler, true); }
}
