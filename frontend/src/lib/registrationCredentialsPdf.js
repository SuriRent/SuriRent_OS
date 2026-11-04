function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function openRegistrationCredentialsPdf({ url, email, password, pin }) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.opener = null;
  const rows = [
    ['URL', url],
    ['E-mailadres', email],
    ['Wachtwoord', password],
    ['Pincode', pin],
  ];
  const content = rows.map(([label, value]) => (
    `<p><strong>${label}</strong><br>${escapeHtml(value)}</p>`
  )).join('');

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8">
        <title>SuriRent-inloggegevens</title>
        <style>
          @page { margin: 20mm; }
          body { color: #0B1B3F; font: 14pt Arial, sans-serif; }
          p { margin: 0 0 18pt; overflow-wrap: anywhere; }
          strong { display: inline-block; margin-bottom: 4pt; }
        </style>
      </head>
      <body>${content}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}
