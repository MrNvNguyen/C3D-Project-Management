/** Optional R2 object storage. Falls back to D1 TEXT when FILES is unbound. */

export type FileEnv = {
  FILES?: R2Bucket
}

export function avatarApiPath(userId: number): string {
  return `/api/users/${userId}/avatar`
}

export function attachmentApiPath(id: number): string {
  return `/api/messages/attachments/${id}`
}

export function parseDataUri(dataUri: string): { contentType: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri)
  if (!m) return null
  const binary = atob(m[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { contentType: m[1], bytes }
}

export function bytesToDataUri(contentType: string, bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  arr.forEach(b => { binary += String.fromCharCode(b) })
  return `data:${contentType};base64,${btoa(binary)}`
}

export async function putR2(env: FileEnv, key: string, bytes: ArrayBuffer | Uint8Array, contentType: string): Promise<boolean> {
  if (!env.FILES) return false
  await env.FILES.put(key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
    httpMetadata: { contentType },
  })
  return true
}

export async function getR2(env: FileEnv, key: string): Promise<R2ObjectBody | null> {
  if (!env.FILES || !key) return null
  return await env.FILES.get(key)
}

export async function storeAvatar(env: FileEnv, userId: number, dataUri: string): Promise<{ avatar: string }> {
  const parsed = parseDataUri(dataUri)
  if (!parsed) return { avatar: dataUri }
  const key = `avatars/${userId}`
  const stored = await putR2(env, key, parsed.bytes, parsed.contentType)
  return { avatar: stored ? `r2:${key}` : dataUri }
}

export function isR2Ref(value: string | null | undefined): boolean {
  return !!value && value.startsWith('r2:')
}

export function r2KeyFromRef(value: string): string {
  return value.slice(3)
}

export async function storeMaybeDataUri(
  env: FileEnv,
  key: string,
  dataUri: string | null | undefined
): Promise<{ storedValue: string | null; r2Key: string | null; contentType: string | null; byteLength: number | null }> {
  if (!dataUri) return { storedValue: null, r2Key: null, contentType: null, byteLength: null }
  if (!dataUri.startsWith('data:')) {
    return { storedValue: dataUri, r2Key: isR2Ref(dataUri) ? r2KeyFromRef(dataUri) : null, contentType: null, byteLength: null }
  }
  const parsed = parseDataUri(dataUri)
  if (!parsed) return { storedValue: dataUri, r2Key: null, contentType: null, byteLength: null }
  const ok = await putR2(env, key, parsed.bytes, parsed.contentType)
  if (ok) {
    return { storedValue: `r2:${key}`, r2Key: key, contentType: parsed.contentType, byteLength: parsed.bytes.length }
  }
  return { storedValue: dataUri, r2Key: null, contentType: parsed.contentType, byteLength: parsed.bytes.length }
}

/** List payloads must not include base64. Point the client at a download URL instead. */
export function publicLegalDocument(d: any) {
  if (!d) return d
  const raw = d.file_url
  const hasFlag = d.has_file_flag === 1 || d.has_file_flag === true
  const stored =
    !!d.r2_key ||
    (typeof raw === 'string' && (raw.startsWith('data:') || isR2Ref(raw))) ||
    (hasFlag && !raw)
  const { r2_key, has_file_flag, ...rest } = d
  return {
    ...rest,
    has_file: hasFlag || !!(raw || r2_key),
    file_url: stored ? `/api/legal/documents/${d.id}/file` : (raw || null),
  }
}
