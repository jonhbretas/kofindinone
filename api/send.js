const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Konfide In One <hello@konfideinone.com>';
const TO = 'jonathanbretas@gmail.com'; // TODO: switch to hello@konfideinone.com once live testing is done

function esc(v) {
  return String(v || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function row(label, value) {
  if (!value) return '';
  return (
    '<tr>' +
    '<td style="padding:10px 0;border-bottom:1px solid #EFE7DA;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A7A63;width:180px;vertical-align:top;">' + esc(label) + '</td>' +
    '<td style="padding:10px 0;border-bottom:1px solid #EFE7DA;font-size:15px;color:#2B2118;vertical-align:top;">' + esc(value) + '</td>' +
    '</tr>'
  );
}

function buildEmailHtml(fields) {
  var audienceLabel = { corporate: 'Corporate', residential: 'Residential', individual: 'Individual' }[fields.audience] || fields.audience;
  var goals = Array.isArray(fields.goals) ? fields.goals.join(', ') : fields.goals;

  return (
    '<div style="background:#F5EFE4;padding:40px 20px;font-family:Georgia,\'Times New Roman\',serif;">' +
      '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #EFE7DA;">' +
        '<div style="background:#1B140F;padding:32px 36px;">' +
          '<div style="font-size:20px;letter-spacing:.02em;color:#F2EBE0;">Konfide In One</div>' +
          '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C79862;margin-top:6px;">New Get Started submission</div>' +
        '</div>' +
        '<div style="padding:32px 36px;">' +
          '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#B4834F;font-weight:bold;margin-bottom:16px;">' + esc(audienceLabel) + '</div>' +
          '<table style="width:100%;border-collapse:collapse;font-family:Georgia,\'Times New Roman\',serif;">' +
            row('Name', fields.name) +
            row('Email', fields.email) +
            row('Phone', fields.phone) +
            row('Company', fields.company) +
            row('Role', fields.role) +
            row('Headcount', fields.headcount) +
            row('Building', fields.building) +
            row('Starting point', fields.starting_point) +
            row('Goals', goals) +
            row('Message', fields.message) +
          '</table>' +
        '</div>' +
        '<div style="padding:20px 36px;background:#FAF6EF;font-size:12px;color:#8A7A63;">Sent from the Get Started form at konfideinone.com</div>' +
      '</div>' +
    '</div>'
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    var fields = req.body || {};

    var html = buildEmailHtml(fields);

    var result = await resend.emails.send({
      from: FROM,
      to: TO,
      reply_to: fields.email || undefined,
      subject: 'New Get Started submission — ' + (fields.name || 'Unknown'),
      html: html
    });

    if (result.error) {
      res.status(502).json({ error: result.error.message || 'Resend error' });
      return;
    }

    res.status(200).json({ ok: true, id: result.data && result.data.id });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unexpected error' });
  }
};
