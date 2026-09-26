export interface Ack {
  profile: 'gamexr.usb-bench/v1'; type: 'ack'; session: number; seq: number;
  status: string; active: boolean; lease_ms: number; outputs_enabled: false;
  motor_outputs: number[]; virtual_motors: number[];
}
interface Expected { status: string; seq: number; session?: number }
interface Result { ok: boolean; status?: number; text(): Promise<string> }
interface Options {
  method: string; cache: RequestCache; headers: Record<string,string>; body: string;
  signal?: AbortSignal; keepalive?: boolean;
}
export function validateAck(value: unknown, expected: Expected): Ack;
export class BenchClient {
  constructor(key: string, options?: {
    request?: (url: string, options: Options) => Promise<Result>;
    report?: (message: string, ack: Ack | null) => void;
    axes?: () => number[];
  });
  active: boolean; busy: boolean; epoch: number; timer: ReturnType<typeof setTimeout> | null;
  enable(): Promise<void>;
  step(epoch: number): Promise<void>;
  stop(reason?: string): void;
}
