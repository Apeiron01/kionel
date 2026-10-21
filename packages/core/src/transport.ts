/** L1 sürücülerinin ortak sözleşmesi — üst katman taşıma türünü bilmez. */
export interface RasterFrame {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface TransportDriver<Options, Calibration = never> {
  readonly id: string;
  capacityBytes(options: Options): number;
  encode(payload: Uint8Array, options: Options): RasterFrame;
  decode(frame: ImageData, options: Options): Promise<Uint8Array | null>;
  calibrate?: (samples: ImageData[], options: Options) => Calibration;
}
