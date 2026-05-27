export type Link = { code: string; url: string }

export class LinkStore {
  private links = new Map<string, string>()

  create(url: string, code?: string): Link {
    const resolved = code ?? this.makeCode()
    this.links.set(resolved, url)
    return { code: resolved, url }
  }

  resolve(code: string): string | undefined {
    return this.links.get(code)
  }

  private makeCode(): string {
    return Math.random().toString(36).slice(2, 8)
  }
}
