import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { redis } from '../lib/redis.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const userSocketKey = (userId) => `user:${userId}:socket`;

router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data: rows, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) return res.status(500).json({ error: 'Failed to load friends' });

  const acceptedIds = [];
  const pendingIncoming = [];

  for (const row of rows || []) {
    if (row.status === 'accepted') {
      acceptedIds.push(row.requester_id === userId ? row.addressee_id : row.requester_id);
    } else if (row.status === 'pending' && row.addressee_id === userId) {
      pendingIncoming.push(row.requester_id);
    }
  }

  const allIds = [...new Set([...acceptedIds, ...pendingIncoming])];
  let profileMap = {};
  if (allIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, rating')
      .in('id', allIds);
    profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }

  let onlineStatus = {};
  if (acceptedIds.length) {
    const pipeline = redis.pipeline();
    for (const id of acceptedIds) pipeline.get(userSocketKey(id));
    const results = await pipeline.exec();
    acceptedIds.forEach((id, i) => { onlineStatus[id] = !!results[i][1]; });
  }

  res.json({
    friends: acceptedIds.map((id) => ({
      id,
      username: profileMap[id]?.username,
      rating: profileMap[id]?.rating,
      online: onlineStatus[id] ?? false,
    })),
    pendingIncoming: pendingIncoming.map((id) => ({
      id,
      username: profileMap[id]?.username,
    })),
  });
});

router.post('/request', requireAuth, async (req, res) => {
  const { targetUsername } = req.body;
  if (!targetUsername) return res.status(400).json({ error: 'targetUsername is required' });

  const { data: target } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', targetUsername)
    .single();

  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

  const { data: existing } = await supabase
    .from('friendships')
    .select('id, status, requester_id')
    .or(`and(requester_id.eq.${req.user.id},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${req.user.id})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.status === 'pending') {
      if (existing.requester_id === target.id) {
        await supabase.from('friendships').update({ status: 'accepted' }).eq('id', existing.id);
        return res.json({ message: `You are now friends with ${target.username}` });
      }
      return res.status(409).json({ error: 'Friend request already sent' });
    }
  }

  const { error } = await supabase.from('friendships').insert({
    requester_id: req.user.id,
    addressee_id: target.id,
    status: 'pending',
  });

  if (error) return res.status(500).json({ error: 'Failed to send friend request' });
  res.json({ message: `Friend request sent to ${target.username}` });
});

router.post('/accept', requireAuth, async (req, res) => {
  const { requesterId } = req.body;
  if (!requesterId) return res.status(400).json({ error: 'requesterId is required' });

  const { data, error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester_id', requesterId)
    .eq('addressee_id', req.user.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Friend request not found' });
  res.json({ message: 'Friend request accepted' });
});

router.delete('/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const myId = req.user.id;
  await supabase
    .from('friendships')
    .delete()
    .or(`and(requester_id.eq.${myId},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${myId})`);
  res.json({ message: 'Removed' });
});

export default router;
