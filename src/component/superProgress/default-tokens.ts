import { ProgressTokenDefinitions, ProgressState } from './super-progress';

// https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart
function padStart(s:string, targetLength:number, padString:string) {
  targetLength = targetLength >> 0; //truncate if number or convert non-number to 0;
  padString = String((typeof padString !== 'undefined' ? padString : ' '));
  if (s.length > targetLength) {
    return String(s);
  }
  else {
    targetLength = targetLength - s.length;
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length); //append to original to ensure we are longer than needed
    }
    return padString.slice(0, targetLength) + String(s);
  }
};

export const defaultTokenDefinitions: ProgressTokenDefinitions = {
  // the bar token displays a bar showing how much of a process has
  // completed.  It takes up as much space as the layout engine will
  // allow.  This is specified by returning -1 in the width function.
  bar: {

    render: (state: ProgressState, allowed: number): string => {
      let percent = state.percentComplete;
      if (percent > 1.00) {
        percent = 1;
      }

      let complete = Math.floor(allowed * percent);

      return `\u001B[104m${' '.repeat(complete)}\u001B[100m${' '.repeat(allowed - complete)}\u001B[49m`;
    },
    width: () => -1
  },

  // the elapsed token displays the amount time that has elapsed since
  // the beginning of the process.  It is displayed in hh:mm:ss.sss format.
  // Since we know the exact width of the desired output, we return it
  // in the width function.
  elapsed: {
    render: (state: ProgressState): string => {
      let seconds = (state.elapsedTime / 1000) % 60;
      let minutes = Math.floor((state.elapsedTime / 1000 / 60) % 60);
      let hours = Math.floor((state.elapsedTime / 1000 / 60 / 60));
      return `${padStart(hours.toString(), 2, '0')}:${padStart(minutes.toString(), 2, '0')}:${padStart(seconds.toFixed(3), 6, '0')}`;
    },
    width: () => 12
  },
  // the percent token displays the amount of the process that has been
  // completed as a percentage.  It shows 2 decimal places of precision.
  percent: {
    render: (state: ProgressState): string => {
      return (state.percentComplete * 100).toFixed(2) + '%';
    },
    width: () => 7
  },
  // The spinner token simply displays an ascii 'wheel' that constantly
  // spins as the process is occurring.
  spinner: {
    render: (): string => {
      const frames: string[] = [
        '-',
        '\\',
        '|',
        '/'
      ];

      return frames[Math.floor((Date.now() % 500) / 125)];
    },
    width: () => 1
  }
};