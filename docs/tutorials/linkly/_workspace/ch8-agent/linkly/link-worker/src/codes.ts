const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function makeCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return s
}
