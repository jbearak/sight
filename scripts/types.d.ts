// Type declarations for Bun-specific features used in scripts

declare module 'bun' {
  export const $: any;
}

declare global {
  namespace ImportMeta {
    const main: boolean;
  }
}

export {};
