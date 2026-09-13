/** CSS module compilation shared by the client and lazy chunk build targets. */
import { transform } from 'lightningcss'

/** Stylesheet text and its exported local-to-hashed class names. */
export interface CompiledCssModule {
  cssText: string
  classMap: Record<string, string>
}

/**
 * Compile one stylesheet for embedding in a JavaScript module.
 * @param filename - Absolute source pathname.
 * @param source - Original CSS bytes.
 * @param projectRoot - Checkout root used to keep class hashes independent of absolute paths.
 * @returns stylesheet text paired with exports in deterministic UTF-16 key order.
 */
export function compileCssModule(filename: string, source: Uint8Array, projectRoot: string): CompiledCssModule {
  const { code, exports } = transform({ filename, projectRoot, code: source, cssModules: { pattern: '[hash]_[local]' }, minify: true })
  const classMap: Record<string, string> = {}
  const entries = Object.entries(exports ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  for (const [local, value] of entries) classMap[local] = value.name
  return { cssText: code.toString(), classMap }
}
