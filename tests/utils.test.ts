/**
 * Unit tests for getDomain utility.
 */
import { describe, it, expect } from 'vitest';
import { getDomain } from '../src/lib/utils';

describe('getDomain', () => {
    it('extracts hostname from a standard URL', () => {
        expect(getDomain('https://example.com/path')).toBe('example.com');
    });

    it('strips www. prefix', () => {
        expect(getDomain('https://www.example.com')).toBe('example.com');
    });

    it('preserves subdomains other than www', () => {
        expect(getDomain('https://blog.example.com')).toBe('blog.example.com');
    });

    it('returns empty string for undefined', () => {
        expect(getDomain(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(getDomain('')).toBe('');
    });

    it('returns empty string for invalid URL', () => {
        expect(getDomain('not-a-url')).toBe('');
    });

    it('handles URL with port', () => {
        expect(getDomain('https://localhost:3000')).toBe('localhost');
    });

    it('handles chrome:// URLs', () => {
        expect(getDomain('chrome://extensions')).toBe('extensions');
    });
});
