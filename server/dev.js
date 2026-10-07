import app from './app.js';
process.env.NODE_ENV ??= 'development';
const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Enquiry API: http://localhost:${port}`));
