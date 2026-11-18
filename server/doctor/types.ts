// Shapes every check follows. One check = one file in checks/.

export type Status = "ok" | "info" | "warn" | "bad";

export type Result = {
  status: Status;
  message: string;      // one short sentence, plain words
  detail?: string;      // optional extra line
  link?: string;        // optional dashboard link, e.g. "#/apps/shop/logs"
  canFix?: boolean;     // false hides the Fix button even if the check has one
};

export type Fix = {
  label: string;                         // button text, e.g. "Free up space"
  describe: () => Promise<string>;       // what will happen, shown before running
  run: (log: (line: string) => void) => Promise<void>;
};

export type Check = {
  id: string;
  title: string;
  check: () => Promise<Result>;
  fix?: Fix;
};
