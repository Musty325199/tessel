import { describe, expect, it } from 'vitest';
import { cloudinaryConfig, sign } from '../src/uploads.js';

describe('uploads', () => {
  it('reads the Cloudinary URL and signs like Cloudinary does', () => {
    expect(cloudinaryConfig('cloudinary://123456:abcSECRET@demo-cloud')).toEqual({ apiKey: '123456', secret: 'abcSECRET', cloud: 'demo-cloud' });
    expect(cloudinaryConfig('nope')).toBeNull();
    // example from Cloudinary's docs: eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510 + secret abcd
    expect(sign({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});
