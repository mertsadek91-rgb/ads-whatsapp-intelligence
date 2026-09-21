export function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "unauthorized" });
}

/**
 * Role gate. `role` was stored on the session at login and read back by /me,
 * but nothing ever enforced it — so every signed-in account, including a
 * read-only sales agent, could rotate the Meta token, change settings, or fire
 * a WhatsApp broadcast at the whole contact list (which costs real money per
 * message). The client-side "type the campaign name to arm Send" guard in the
 * Broadcasts page was the only thing in the way, and a client-side guard is
 * not a guard.
 *
 * Fails closed: a session with no role at all is refused, not defaulted.
 */
export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: "unauthorized" });
    if (!allowed.has(req.session.role)) {
      return res.status(403).json({
        error: "forbidden",
        // Say what is required, never what the caller has.
        required: [...allowed],
      });
    }
    return next();
  };
}

export default requireAuth;
