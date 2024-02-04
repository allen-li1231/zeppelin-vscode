import { defaultTokenDefinitions } from './default-tokens';
import { Writable, Transform } from 'stream';
import { EOL } from 'os';
const stringWidth = require('string-width');
const ansiEscapes = require('ansi-escapes');

export interface ProgressOptions {
  total?: number;
  pattern?: string;
  renderInterval?: number;
}

export interface ProgressState {
  startTime: number;
  elapsedTime: number;
  remainingTime: number;
  nextRender: number;

  percentComplete: number;
  rateTicks: number;
  currentTicks: number;
  totalTicks: number;
  ticksLeft: number;
}

export interface ProgressTokenDefinitions {
  [key: string]: {
    render: (state: ProgressState, spaceAllowedPerStar: number) => string;
    width: (state: ProgressState) => number;
  }
}

export class Progress extends Transform {

  public static create = (
    width: number,
    options?: ProgressOptions,
    tokens?: ProgressTokenDefinitions,
    state?: ProgressState): Progress => {

    let o: ProgressOptions = { ...Progress.defaultProgressOptions, ...options }
    o.pattern = o.pattern!;
    o.total = o.total!;
    o.renderInterval = o.renderInterval!;

    let t: ProgressTokenDefinitions = { ...defaultTokenDefinitions, ...tokens }
    let s: ProgressState = {
      elapsedTime: 0,
      remainingTime: 0,
      percentComplete: 0,
      currentTicks: 0,
      rateTicks: 0,
      nextRender: 0,
      startTime: Date.now(),
      totalTicks: 100,
      ticksLeft: 100,
      ...state
    };

    if (o.total) {
      s.totalTicks = o.total;
      s.ticksLeft = o.total;
    }

    return new Progress(width, o, t, s);
  }

  public static defaultProgressOptions: ProgressOptions = {
    total: 100,
    pattern: `[{spinner}] {bar} | Elapsed: {elapsed} | {percent}`,
    renderInterval: 33
  }

  private constructor(
    public width: number,
    public options: ProgressOptions,
    public tokens: ProgressTokenDefinitions,
    public state: ProgressState) {
    super({
      readableObjectMode: true
    });
  }

  _transform(data: string | Buffer,
    encoding: string,
    callback: Function): any | undefined {
    this.update(data.length)
      .then(() => this.render())
      .then((r: string[]) => {
        this.push(r);
        callback();
      });
  }

  _flush(callback: Function) {
    this.complete()
      .then(() => this.render())
      .then((r: string[]) => {
        this.push(r);
        callback();
      });
  }

  public async tick(ticks: number = 1, stream: Writable = process.stdout): Promise<void> {
    return this.update(ticks)
      .then(() => this.render())
      .then(r => this.display(r, stream));
  }

  public async display(rendered: string[], stream: Writable): Promise<void> {

    let time = Date.now();
    if (time >= this.state.nextRender) {
      this.state.nextRender = time + this.options.renderInterval!;

      stream.write(rendered.join(EOL) + ansiEscapes.cursorUp(rendered.length - 1) + ansiEscapes.cursorLeft);
    }
  }

  public async update(ticks: number = 1): Promise<void> {
    this.state.currentTicks += ticks;                                               // ticks
    this.state.percentComplete = this.state.currentTicks / this.state.totalTicks;   // raw decimal
    this.state.elapsedTime = Date.now() - this.state.startTime;                     // ms
    this.state.ticksLeft = this.state.totalTicks - this.state.currentTicks;         // ticks
    this.state.rateTicks = this.state.currentTicks / this.state.elapsedTime;        // ticks/ms
    this.state.remainingTime = this.state.ticksLeft / this.state.rateTicks;      // ms
  }

  public async complete(): Promise<void> {
    this.state.currentTicks = this.state.totalTicks;
    this.state.percentComplete = 1.0;
    this.state.elapsedTime = Date.now() - this.state.startTime;
    this.state.ticksLeft = 0;
    this.state.rateTicks = this.state.currentTicks / this.state.elapsedTime;
    this.state.remainingTime = 0;
  }

  public async render(): Promise<string[]> {
    let lines: string[] = this.options.pattern!.split(/\r\n|\r|\n/g);
    return Promise.all(lines.map(s => this.renderLine(s, this.width)));
  }

  private async renderLine(line: string, available: number): Promise<string> {
    let spaceTaken: number = 0;
    let stars: number = 0;
    let leftovers: string = line;
    let widths: { [index: string]: number } = {};

    // loop through each token and acquire the length for each
    // if the token returns a -1 instead of a width, then
    // we will tell it how much space it has on the next pass
    for (let token in this.tokens) {
      leftovers = leftovers.replace(new RegExp(`{${token}}`, 'g'), '');
      let matches = line.match(new RegExp(`\{${token}\}`, 'g'));
      if (matches !== null) {
        widths[token] = this.tokens[token].width(this.state);
        if (widths[token] === -1) {
          stars += matches.length;
        } else {
          spaceTaken += (matches.length * widths[token]);
        }
      }
    }

    const spaceAvailable = Math.max(0, available - leftovers.length - spaceTaken);

    let spacePerStar = 0;
    if (stars > 0) {
      spacePerStar = Math.floor(spaceAvailable / stars);
    }

    let rendered: string = line;
    for (let token in widths) {
      let renderedToken = this.tokens[token].render(this.state, spacePerStar);
      let expectedWidth = widths[token] === -1 ? spacePerStar : widths[token];
      let renderedTokenWidth = stringWidth(renderedToken);

      if (renderedTokenWidth < expectedWidth) {
        renderedToken = renderedToken + ' '.repeat(expectedWidth - renderedTokenWidth);
      } else if (renderedTokenWidth > expectedWidth) {
        renderedToken = renderedToken.substring(0, expectedWidth);
      }

      rendered = rendered.replace(new RegExp(`{${token}}`, 'g'), renderedToken);
    }

    let renderedWidth = stringWidth(rendered);

    if (renderedWidth < available) {
      rendered = rendered + ' '.repeat(available - renderedWidth);
    }
    //  else if (renderedWidth > available) {
    //   rendered = rendered.substring(0, available - 1);
    // }

    return rendered;
  }
}