export type Limit = { kind: string; percent: number; resetsAt?: string }

// Hors forfait (« extra usage ») ; montants en centimes, comme les renvoie l'API.
export type Extra = { isEnabled: boolean; usedCents: number | null; limitCents: number | null; percent: number | null; currency: string }

export type Hud = {
  project?: string
  branch?: string
  isDirty: boolean
  limits: Limit[]
  extra?: Extra
  tokens?: number
  startedAt?: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'desktop-hud': { hud: Hud }
  }
}
