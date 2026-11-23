const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  // L'application mobile envoie le token dans le header : "Authorization: Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Accès refusé. Token manquant.',
    });
  }

  try {
    // Vérifie que le token est authentique et non expiré
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Contient { id, username, role }
    next(); // Passe à la suite (la route demandée)
  } catch (err) {
    return res.status(403).json({
      error: 'Token invalide ou expiré.',
    });
  }
}

module.exports = verifyToken;
