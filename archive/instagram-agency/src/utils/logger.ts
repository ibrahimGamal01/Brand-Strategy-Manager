type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function log(level: LogLevel, message: string, data?: unknown): void {
  const levelColors: Record<LogLevel, string> = {
    debug: COLORS.dim,
    info: COLORS.green,
    warn: COLORS.yellow,
    error: COLORS.red,
  };

  const prefix = `${COLORS.dim}[${timestamp()}]${COLORS.reset} ${levelColors[level]}[${level.toUpperCase()}]${COLORS.reset}`;
  
  console.log(`${prefix} ${message}`);
  if (data) {
    console.log(COLORS.dim + JSON.stringify(data, null, 2) + COLORS.reset);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
  
  step: (step: number, total: number, msg: string) => {
    console.log(`\n${COLORS.magenta}━━━ Step ${step}/${total}: ${msg} ━━━${COLORS.reset}`);
  },
  
  success: (msg: string) => {
    console.log(`${COLORS.green}✅ ${msg}${COLORS.reset}`);
  },
  
  waiting: (seconds: number) => {
    console.log(`${COLORS.cyan}⏳ Waiting ${seconds}s before next API call...${COLORS.reset}`);
  },
};
