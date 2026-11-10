// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-explicit-any */
// OAuth pieces: registration signing, redirect rules, PKCE, signed page state, metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    authServerMetadata, linkFromResource, protectedResourceMetadata, redirectUriAllowed, registerClient,
    signPageState, verifyClientId, verifyPageState, verifyPkce, wwwAuthenticate, type PageState,
} from '../src/oauth.ts';
import { sha256 } from '../src/util.ts';
import { LINK_ID, SECRET } from './fakes.ts';

const ORIGIN = 'https://connector.example';

test('registration returns a signed client id that verifies and names the app', async () => {
    const r = await registerClient(SECRET, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude', token_endpoint_auth_method: 'client_secret_post' }, 1_700_000_000_000);
    assert.equal(r.ok, true);
    const body = (r as any).body;
    assert.equal(body.token_endpoint_auth_method, 'none');
    const rec = await verifyClientId(SECRET, body.client_id);
    assert.deepEqual(rec, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude', iat: 1_700_000_000 });
});

test('a tampered or foreign client id is rejected', async () => {
    const r: any = await registerClient(SECRET, { redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], client_name: 'ChatGPT' }, Date.now());
    const [payload, mac] = r.body.client_id.split('.');
    const evil = Buffer.from(JSON.stringify({ redirect_uris: ['https://evil.example/cb'], client_name: 'ChatGPT', iat: 1 })).toString('base64url');
    assert.equal(await verifyClientId(SECRET, `${evil}.${mac}`), null);
    assert.equal(await verifyClientId(SECRET, `${payload}.${mac.slice(0, -2)}AA`), null);
    assert.equal(await verifyClientId('another-secret', r.body.client_id), null);
    assert.equal(await verifyClientId(SECRET, 'not-a-client'), null);
    assert.equal(await verifyClientId(SECRET, undefined), null);
});

test('client names are cleaned of control and bidi characters', async () => {
    const r: any = await registerClient(SECRET, { redirect_uris: ['https://a.example/cb'], client_name: 'Cla‮ude\u0000' }, Date.now());
    assert.equal(r.body.client_name, 'Claude');
});

test('redirect URIs: https anywhere, http only on loopback, no fragments or user info', () => {
    for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:33418/callback', 'http://127.0.0.1:9/cb', 'http://[::1]:8080/cb']) {
        assert.equal(redirectUriAllowed(ok), true, ok);
    }
    for (const bad of ['http://example.com/cb', 'https://a.example/cb#x', 'https://u:p@a.example/cb', 'cursor://anysphere/cb', 'javascript:alert(1)', '', 'https://' + 'a'.repeat(2000), 42]) {
        assert.equal(redirectUriAllowed(bad), false, String(bad).slice(0, 40));
    }
});

test('registration refuses bad redirect URIs and bad metadata', async () => {
    assert.equal(((await registerClient(SECRET, { redirect_uris: ['http://evil.example/cb'] }, 0)) as any).error, 'invalid_redirect_uri');
    assert.equal(((await registerClient(SECRET, { redirect_uris: [] }, 0)) as any).error, 'invalid_redirect_uri');
    assert.equal(((await registerClient(SECRET, { redirect_uris: Array(6).fill('https://a.example/cb') }, 0)) as any).error, 'invalid_redirect_uri');
    assert.equal(((await registerClient(SECRET, [], 0)) as any).error, 'invalid_client_metadata');
    assert.equal(((await registerClient(SECRET, { redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, 0)) as any).error, 'invalid_client_metadata');
});

test('PKCE S256 checks the verifier against the challenge', async () => {
    // RFC 7636 appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    assert.equal(await sha256(verifier), challenge);
    assert.equal(await verifyPkce(verifier, challenge), true);
    assert.equal(await verifyPkce(verifier.slice(0, -1) + 'Y', challenge), false);
    assert.equal(await verifyPkce('short', challenge), false);
    assert.equal(await verifyPkce(undefined, challenge), false);
});

const page = (over: Partial<PageState> = {}): PageState => ({
    linkId: LINK_ID, clientId: 'cid', clientName: 'Claude', redirectUri: 'https://claude.ai/cb', state: 's1',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', issuer: `${ORIGIN}/mcp/${LINK_ID}`, pairingId: 'p'.repeat(22),
    exp: 2_000, ...over,
});

test('signed page state round-trips and rejects tampering and expiry', async () => {
    const signed = await signPageState(SECRET, page());
    assert.deepEqual(await verifyPageState(SECRET, signed, 1_000), page());
    assert.equal(await verifyPageState(SECRET, signed, 3_000), 'expired');
    const [, mac] = signed.split('.');
    const forged = Buffer.from(JSON.stringify(page({ redirectUri: 'https://evil.example/cb' }))).toString('base64url');
    assert.equal(await verifyPageState(SECRET, `${forged}.${mac}`, 1_000), null);
    assert.equal(await verifyPageState('other', signed, 1_000), null);
    assert.equal(await verifyPageState(SECRET, signed + 'x', 1_000), null);
});

test('a client id never verifies as page state, nor the reverse', async () => {
    const r: any = await registerClient(SECRET, { redirect_uris: ['https://a.example/cb'] }, 0);
    assert.equal(await verifyPageState(SECRET, r.body.client_id, 0), null);
    assert.equal(await verifyClientId(SECRET, await signPageState(SECRET, page())), null);
});

test('metadata: path form names the link, root form names the origin', () => {
    const prm = protectedResourceMetadata(ORIGIN, LINK_ID);
    assert.equal(prm.resource, `${ORIGIN}/mcp/${LINK_ID}`);
    assert.deepEqual(prm.authorization_servers, [`${ORIGIN}/mcp/${LINK_ID}`]);
    const as = authServerMetadata(ORIGIN, LINK_ID);
    assert.equal(as.issuer, `${ORIGIN}/mcp/${LINK_ID}`);
    assert.equal(as.authorization_endpoint, `${ORIGIN}/mcp/${LINK_ID}/authorize`);
    assert.equal(as.token_endpoint, `${ORIGIN}/mcp/${LINK_ID}/token`);
    assert.equal(as.registration_endpoint, `${ORIGIN}/register`);
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
    const root = authServerMetadata(ORIGIN);
    assert.equal(root.issuer, ORIGIN);
    assert.equal(root.authorization_endpoint, `${ORIGIN}/authorize`);
    assert.equal(protectedResourceMetadata(ORIGIN).resource, ORIGIN);
});

test('resource parameter maps to a link only when it is ours', () => {
    assert.equal(linkFromResource(ORIGIN, `${ORIGIN}/mcp/${LINK_ID}`), LINK_ID);
    assert.equal(linkFromResource(ORIGIN, `${ORIGIN}/mcp/${LINK_ID}/`), LINK_ID);
    assert.equal(linkFromResource(ORIGIN, `https://other.example/mcp/${LINK_ID}`), null);
    assert.equal(linkFromResource(ORIGIN, `${ORIGIN}/mcp/short`), null);
    assert.equal(linkFromResource(ORIGIN, null), null);
});

test('WWW-Authenticate points at the resource metadata', () => {
    assert.equal(wwwAuthenticate(ORIGIN, LINK_ID), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/${LINK_ID}"`);
    assert.match(wwwAuthenticate(ORIGIN, LINK_ID, 'invalid_token'), /error="invalid_token"$/);
});
