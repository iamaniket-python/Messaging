import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { hasTestDb, resetDb, resetChatData, createUser, createGroup, as } from './helpers.js';

describe.skipIf(!hasTestDb)('Conversations (integration, real DB)', () => {
  let ann;
  let bob;
  let cat;
  let dan;

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    ann = await createUser('Ann');
    bob = await createUser('Bob');
    cat = await createUser('Cat');
    dan = await createUser('Dan');
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a DM once and returns the same one from either side', async () => {
    const first = await as(ann).post('/conversations', { type: 'dm', userId: bob.id });
    expect(first.status).toBe(201);
    expect(first.body.data.conversation.type).toBe('dm');

    const second = await as(bob).post('/conversations', { type: 'dm', userId: ann.id });
    expect(second.status).toBe(200);
    expect(second.body.data.conversation.id).toBe(first.body.data.conversation.id);
  });

  it('rejects a DM with yourself or with an unknown user', async () => {
    const self = await as(ann).post('/conversations', { type: 'dm', userId: ann.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_DM_SELF');

    const unknown = await as(ann).post('/conversations', {
      type: 'dm',
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_MEMBERS');
  });

  it('creates a group with the creator as owner and lists members', async () => {
    const group = await createGroup(ann, [bob, cat]);
    const res = await as(ann).get(`/conversations/${group.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.memberCount).toBe(3);
    expect(res.body.data.conversation.myRole).toBe('owner');

    const roles = Object.fromEntries(res.body.data.conversation.members.map((m) => [m.userId, m.role]));
    expect(roles[ann.id]).toBe('owner');
    expect(roles[bob.id]).toBe('member');
    expect(roles[cat.id]).toBe('member');
  });

  it('hides conversations from non-members with 404', async () => {
    const group = await createGroup(ann, [bob]);
    const res = await as(dan).get(`/conversations/${group.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('enforces unique channel names and valid channel names', async () => {
    const first = await as(ann).post('/conversations', { type: 'channel', name: 'general' });
    expect(first.status).toBe(201);
    expect(first.body.data.conversation.visibility).toBe('public');

    const duplicate = await as(bob).post('/conversations', { type: 'channel', name: 'General' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CHANNEL_NAME_TAKEN');

    const invalid = await as(bob).post('/conversations', { type: 'channel', name: 'bad name!' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets only owners and admins add members, and never to a DM', async () => {
    const group = await createGroup(ann, [bob]);

    const byMember = await as(bob).post(`/conversations/${group.id}/members`, { userIds: [cat.id] });
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

    const byOwner = await as(ann).post(`/conversations/${group.id}/members`, { userIds: [cat.id, dan.id] });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.data.addedUserIds).toHaveLength(2);

    const dm = (await as(ann).post('/conversations', { type: 'dm', userId: bob.id })).body.data.conversation;
    const toDm = await as(ann).post(`/conversations/${dm.id}/members`, { userIds: [cat.id] });
    expect(toDm.status).toBe(400);
    expect(toDm.body.error.code).toBe('DM_MEMBERS_FIXED');
  });

  it('applies member removal rules', async () => {
    const group = await createGroup(ann, [bob, cat, dan]);
    await as(ann).patch(`/conversations/${group.id}/members/${bob.id}`, { role: 'admin' });
    await as(ann).patch(`/conversations/${group.id}/members/${cat.id}`, { role: 'admin' });

    expect((await as(bob).delete(`/conversations/${group.id}/members/${cat.id}`)).status).toBe(403);
    expect((await as(bob).delete(`/conversations/${group.id}/members/${ann.id}`)).status).toBe(403);
    expect((await as(bob).delete(`/conversations/${group.id}/members/${dan.id}`)).status).toBe(204);
    expect((await as(dan).get(`/conversations/${group.id}`)).status).toBe(404);
    expect((await as(ann).delete(`/conversations/${group.id}/members/${cat.id}`)).status).toBe(204);
  });

  it('handles leaving, ownership transfer, and cleanup of empty groups', async () => {
    const group = await createGroup(ann, [bob, cat]);

    expect((await as(bob).post(`/conversations/${group.id}/leave`)).status).toBe(204);
    expect((await as(bob).get(`/conversations/${group.id}`)).status).toBe(404);

    expect((await as(ann).post(`/conversations/${group.id}/leave`)).status).toBe(204);
    const catView = await as(cat).get(`/conversations/${group.id}`);
    expect(catView.body.data.conversation.myRole).toBe('owner');

    expect((await as(cat).post(`/conversations/${group.id}/leave`)).status).toBe(204);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM conversations WHERE id = $1', [group.id]);
    expect(rows[0].n).toBe(0);

    const dm = (await as(ann).post('/conversations', { type: 'dm', userId: bob.id })).body.data.conversation;
    const leaveDm = await as(ann).post(`/conversations/${dm.id}/leave`);
    expect(leaveDm.status).toBe(400);
    expect(leaveDm.body.error.code).toBe('CANNOT_LEAVE_DM');
  });

  it('supports public channel discovery and joining but hides private channels', async () => {
    const channel = (await as(ann).post('/conversations', { type: 'channel', name: 'random' })).body.data
      .conversation;
    const secret = (
      await as(ann).post('/conversations', { type: 'channel', name: 'secret', visibility: 'private' })
    ).body.data.conversation;

    const discovery = await as(bob).get('/conversations/public-channels?q=ran');
    expect(discovery.status).toBe(200);
    expect(discovery.body.data.channels).toHaveLength(1);
    expect(discovery.body.data.channels[0]).toMatchObject({ id: channel.id, memberCount: 1, isMember: false });

    const all = await as(bob).get('/conversations/public-channels');
    expect(all.body.data.channels.map((c) => c.id)).not.toContain(secret.id);

    const joined = await as(bob).post(`/conversations/${channel.id}/join`);
    expect(joined.status).toBe(200);
    expect(joined.body.data.joined).toBe(true);
    expect((await as(bob).get(`/conversations/${channel.id}`)).status).toBe(200);

    expect((await as(bob).post(`/conversations/${secret.id}/join`)).status).toBe(404);
  });

  it('lets only the owner change roles, and promoted admins can add members', async () => {
    const group = await createGroup(ann, [bob, cat]);

    const byMember = await as(bob).patch(`/conversations/${group.id}/members/${cat.id}`, { role: 'admin' });
    expect(byMember.status).toBe(403);

    const promoted = await as(ann).patch(`/conversations/${group.id}/members/${bob.id}`, { role: 'admin' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.member.role).toBe('admin');

    const added = await as(bob).post(`/conversations/${group.id}/members`, { userIds: [dan.id] });
    expect(added.status).toBe(200);
  });

  it('lets only owners and admins update group details', async () => {
    const group = await createGroup(ann, [bob]);

    const byMember = await as(bob).patch(`/conversations/${group.id}`, { name: 'Hacked' });
    expect(byMember.status).toBe(403);

    const byOwner = await as(ann).patch(`/conversations/${group.id}`, {
      name: 'Renamed',
      description: 'New description',
    });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.data.conversation.name).toBe('Renamed');
    expect(byOwner.body.data.conversation.description).toBe('New description');
  });
});