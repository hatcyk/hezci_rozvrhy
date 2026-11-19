// Statický server nad public/ pro e2e testy (spouští ho playwright.config.js).
// Záměrně bez backendu: /api/* obsluhuje atrapa v testech (page.route) a sem
// se dostane jen to, co atrapa nezná – proto 404, ne skutečná data.
const path = require('path');
const express = require('express');

const PORT = Number(process.env.E2E_PORT || 4173);
const PUBLIC = path.join(__dirname, '..', '..', '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res) => res.status(404).json({ error: 'e2e: API je v testech jen atrapa' }));
app.use(express.static(PUBLIC));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e statický server: http://127.0.0.1:${PORT} (${PUBLIC})`);
});
