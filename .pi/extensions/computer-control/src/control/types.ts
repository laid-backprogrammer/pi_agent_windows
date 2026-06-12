export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotResult = {
  path: string;
  width: number;
  height: number;
  left: number;
  top: number;
};

export type Point = {
  x: number;
  y: number;
};

export type PointInput = {
  x?: number;
  y?: number;
  nx?: number;
  ny?: number;
};

export type ResolvedPoint = {
  point: Point;
  coordinateSource: "pixel" | "normalized";
  screen?: ScreenshotResult;
};

export type ApplicationCheckInput = {
  appName?: string;
  processNames?: string[];
  windowTitleIncludes?: string[];
};

export type NormalizedApplicationCheckInput = {
  appName?: string;
  processNames: string[];
  windowTitleIncludes: string[];
};

export type ApplicationProcessMatch = {
  id: number;
  processName: string;
  windowTitle?: string;
  path?: string;
};

export type ApplicationWindowMatch = ApplicationProcessMatch;

export type ApplicationCheckResult = {
  isOpen: boolean;
  matchedProcesses: ApplicationProcessMatch[];
  matchedWindows: ApplicationWindowMatch[];
};

export type StartWeChatResult = {
  started: boolean;
  isOpen: boolean;
  path?: string;
  check: ApplicationCheckResult;
  stdout: string;
  stderr: string;
};

export type WindowRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type WindowHandleInfo = {
  hwnd: number;
  title: string;
  className?: string;
  processId?: number;
  processName?: string;
  rect: WindowRect;
};

export type WindowCandidateDiagnostic = {
  window: WindowHandleInfo;
  score: number;
  reasons: string[];
};

export type WindowSelectionDiagnostics = {
  selected?: WindowHandleInfo;
  scannedCount: number;
  candidates: WindowCandidateDiagnostic[];
};

export type WindowTopmostResult = {
  hwnd: number;
  enabled: boolean;
};

export type OcrChunk = {
  index: number;
  path: string;
  y0: number;
  y1: number;
  width: number;
  height: number;
};

export type WeChatConversationListLocateInput = {
  chatName: string;
  screenshotPath: string;
  region: Region;
  attempt: number;
};

export type WeChatConversationListLocateResult = {
  found: boolean;
  x?: number;
  y?: number;
  nx?: number;
  ny?: number;
  label?: string;
  summary?: string;
  visibleText?: string[];
  rawText?: string;
};

export type WeChatChatOpenResult = {
  method: "conversation-list-vlm" | "search-fallback";
  searchFallbackUsed: boolean;
  attempts: Array<{
    attempt: number;
    screenshotPath: string;
    region: Region;
    found: boolean;
    point?: Point;
    label?: string;
    summary?: string;
    visibleText?: string[];
  }>;
};

export type ScrollTargetSource = "current-cursor" | "pixel" | "normalized" | "region-center";

export type ScrollActionParams = PointInput & {
  region?: Region;
  delta: number;
  repeat?: number;
  delayMs?: number;
};

export type ScrollActionDefaults = {
  repeat: number;
  delayMs: number;
};

export type ScrollActionResult = {
  delta: number;
  repeat: number;
  delayMs: number;
  target?: {
    point: Point;
    coordinateSource: ScrollTargetSource;
  };
};

export type ScrollDirection = "up" | "down";

export type ScrollInputMethod = "wheel" | "keyboard-page";

export type CaptureScrollRegionParams = {
  region: Region;
  direction?: ScrollDirection;
  scrollStep?: number;
  autoCalibrate?: boolean;
  calibrationStep?: number;
  overlapRatio?: number;
  minOverlapRatio?: number;
  restoreToBoundary?: boolean;
  restoreScrollStep?: number;
  restoreMaxAttempts?: number;
  restoreUnchangedFrameLimit?: number;
  maxFrames?: number;
  delayMs?: number;
  unchangedFrameLimit?: number;
  outputDir?: string;
  outputPath?: string;
  outputStitched?: boolean;
};

export type CaptureScrollRegionDefaults = {
  scrollStep: number;
  calibrationStep: number;
  overlapRatio: number;
  minOverlapRatio: number;
  maxFrames: number;
  delayMs: number;
  unchangedFrameLimit: number;
  outputDir: string;
  outputStitched: boolean;
};

export type CaptureScrollRegionStopReason =
  | "maxFrames"
  | "unchanged"
  | "boundaryRestoreFailed"
  | "calibrationFailed"
  | "overlapTooLow"
  | "overlapTooHigh"
  | "overlapMeasurementFailed";

export type ScrollBoundaryTarget = "top" | "bottom";

export type ScrollBoundaryRestoreStopReason = "disabled" | "unchanged" | "maxAttempts";

export type ScrollBoundaryRestoreResult = {
  enabled: boolean;
  targetBoundary?: ScrollBoundaryTarget;
  scrollDirection?: ScrollDirection;
  jumpKey?: "home" | "end";
  inputMethod?: ScrollInputMethod;
  scrollStep?: number;
  delta?: number;
  maxAttempts?: number;
  unchangedFrameLimit?: number;
  attempts: number;
  stopReason: ScrollBoundaryRestoreStopReason;
};

export type ScrollCalibrationResult = {
  autoCalibrate: boolean;
  calibrationStep: number;
  inputMethod: ScrollInputMethod;
  overlapRatio: number;
  targetPixels: number;
  measuredPixels?: number;
  bestStep?: number;
  score?: number;
  reliable: boolean;
  failureReason?: string;
};

export type ScrollMeasurementResult = {
  measuredPixels: number;
  score: number;
};

export type ScrollFrameOverlap = {
  frameIndex: number;
  previousFrameIndex: number;
  inputMethod: ScrollInputMethod;
  scrollStep: number;
  delta: number;
  measuredPixels: number;
  overlapRatio: number;
  score: number;
  adjustmentAttempts: number;
};

export type CaptureScrollRegionResult = {
  manifestPath: string;
  frames: ScreenshotResult[];
  frameCount: number;
  stopReason: CaptureScrollRegionStopReason;
  preflight: {
    boundaryRestore: ScrollBoundaryRestoreResult;
  };
  calibration: ScrollCalibrationResult;
  overlaps: ScrollFrameOverlap[];
  region: Region;
  scroll: {
    direction: ScrollDirection;
    inputMethod: ScrollInputMethod;
    scrollStep: number;
    delta: number;
    maxFrames: number;
    delayMs: number;
    unchangedFrameLimit: number;
    minOverlapRatio: number;
    maxOverlapRatio: number;
    restoreToBoundary: boolean;
    restoreScrollStep: number;
    restoreMaxAttempts: number;
    restoreUnchangedFrameLimit: number;
    outputStitched: boolean;
  };
  stitchedPath?: string;
};

export type WeChatChatRecordsCaptureParams = {
  chatName: string;
  outputDir?: string;
  maxFrames?: number;
  ocrChunkHeight?: number;
  ocrChunkOverlap?: number;
};

export type WeChatChatRecordsDefaults = CaptureScrollRegionDefaults & {
  wechatRecordsOutputDir: string;
  ocrChunkHeight: number;
  ocrChunkOverlap: number;
};

export type WeChatChatRecordsCaptureResult = {
  manifestPath: string;
  outputDir: string;
  chatName: string;
  mainWindow: WindowHandleInfo;
  recordsWindow: WindowHandleInfo;
  recordsRegion: Region;
  preflight: {
    wechatTopmostScreenshot: string;
    recordsWindowTopmostScreenshot: string;
  };
  menuFallbackUsed: boolean;
  chatOpen: WeChatChatOpenResult;
  scrollCapture: CaptureScrollRegionResult;
  stitchedPath?: string;
  ocrChunks: OcrChunk[];
  diagnostics?: {
    mainWindowSelection?: WindowSelectionDiagnostics;
    recordsWindowSelection?: WindowSelectionDiagnostics;
  };
};

export type PowerShellRunner = (
  script: string,
  signal?: AbortSignal,
  singleThreadedApartment?: boolean,
) => Promise<{ stdout: string; stderr: string }>;
