export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface SourceSegment {
  generatedStart: number;
  generatedEnd: number;
  sourceStart: number;
  filePath: string;
  lineStarts: number[];
}

export class SourceMap {
  constructor(
    private readonly segments: SourceSegment[],
    private readonly fallback: SourceLocation,
  ) {}

  public locationAt(generatedOffset: number): SourceLocation {
    let low = 0;
    let high = this.segments.length - 1;
    let segment: SourceSegment | undefined;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const candidate = this.segments[mid];
      if (candidate.generatedStart <= generatedOffset) {
        segment = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!segment || generatedOffset >= segment.generatedEnd) return this.fallback;
    const sourceOffset = segment.sourceStart + generatedOffset - segment.generatedStart;
    let lineLow = 0;
    let lineHigh = segment.lineStarts.length - 1;
    while (lineLow <= lineHigh) {
      const mid = (lineLow + lineHigh) >>> 1;
      if (segment.lineStarts[mid] <= sourceOffset) lineLow = mid + 1;
      else lineHigh = mid - 1;
    }
    const lineIndex = Math.max(0, lineHigh);
    return {
      filePath: segment.filePath,
      line: lineIndex + 1,
      column: sourceOffset - segment.lineStarts[lineIndex] + 1,
    };
  }
}

export function createSourceSegment(
  generatedStart: number,
  generatedEnd: number,
  sourceStart: number,
  lineStarts: number[],
  filePath: string,
): SourceSegment {
  return { generatedStart, generatedEnd, sourceStart, filePath, lineStarts };
}

export function sourceLineStarts(source: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }
  return lineStarts;
}

export function locationInSource(source: string, filePath: string, offset: number): SourceLocation {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  const starts = sourceLineStarts(source);
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= boundedOffset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    filePath,
    line: lineIndex + 1,
    column: boundedOffset - starts[lineIndex] + 1,
  };
}
