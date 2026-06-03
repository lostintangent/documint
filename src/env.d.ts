declare global {
  var process: {
    argv: string[];
    env: {
      NODE_ENV?: string;
      [key: string]: string | undefined;
    };
    exit(code?: number): never;
    stderr: {
      write(data: string | Uint8Array): unknown;
    };
    stdout: {
      write(data: string | Uint8Array): unknown;
    };
    [key: string]: unknown;
  };
}

export {};
