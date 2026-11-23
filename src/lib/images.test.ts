import { cloudinaryProvider, compressToWebP } from './images'

describe('image URLs', () => {
  it('builds a Cloudinary URL from "cloud:publicId" with optional size', () => {
    expect(cloudinaryProvider.url('demo:units/u1/a')).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/units/u1/a')
    expect(cloudinaryProvider.url('demo:a', { w: 400 })).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400,c_limit/a')
    expect(cloudinaryProvider.url('demo:a', { w: 400, h: 300 })).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400,h_300,c_fill/a')
  })
  it('always stays on res.cloudinary.com, whatever the stored id contains', () => {
    for (const id of ['evil.com/x:y', '@evil.com:y', ':only-public-id', 'no-colon']) expect(new URL(cloudinaryProvider.url(id)).hostname).toBe('res.cloudinary.com')
  })
})

describe('compressToWebP input validation', () => {
  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])('rejects %j before touching the file', async (type) => {
    await expect(compressToWebP({ type } as File)).rejects.toThrow()
  })
})
