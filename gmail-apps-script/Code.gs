/**
 * VNIT Freshmen Guide restaurant-request mailer.
 *
 * Deploy as a Google Apps Script web app (execute as you, anyone with the link).
 * Set these Script Properties before enabling the trigger:
 *   RESTAURANT_REQUEST_EMAIL  your Gmail address
 *   RESTAURANT_MAIL_ENDPOINT  https://<project>.supabase.co/functions/v1/restaurant-requests
 *   RESTAURANT_MAIL_TOKEN     a long random value shared with the Edge Function secret
 *
 * The time trigger calls processRestaurantRequests every five minutes. GmailApp
 * sends the email from the Google account that owns this script.
 */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'restaurant-request-mailer' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Use the scheduled worker.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function processRestaurantRequests() {
  var props = PropertiesService.getScriptProperties();
  var recipient = requiredProperty_(props, 'RESTAURANT_REQUEST_EMAIL');
  var endpoint = requiredProperty_(props, 'RESTAURANT_MAIL_ENDPOINT');
  var token = requiredProperty_(props, 'RESTAURANT_MAIL_TOKEN');
  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ action: 'mail_claim' }),
    headers: { 'x-restaurant-mail-token': token }, muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Could not claim restaurant requests: ' + response.getContentText());
  }
  var payload = JSON.parse(response.getContentText());
  (payload.requests || []).forEach(function (request) {
    var subject = 'VNIT Guide restaurant suggestion: ' + request.restaurant_name;
    var text = [
      'A visitor suggested a restaurant for the VNIT Freshmen Guide.', '',
      'Restaurant: ' + request.restaurant_name,
      'Type: ' + request.restaurant_type,
      'Location: ' + request.location,
      'Listing: ' + (request.listing_url || 'Not provided'),
      'Received: ' + request.created_at,
      '', 'Review and add it to the guide when appropriate.',
    ].join('\n');
    var html = '<p>A visitor suggested a restaurant for the VNIT Freshmen Guide.</p>' +
      '<p><strong>Restaurant:</strong> ' + escapeHtml_(request.restaurant_name) + '<br>' +
      '<strong>Type:</strong> ' + escapeHtml_(request.restaurant_type) + '<br>' +
      '<strong>Location:</strong> ' + escapeHtml_(request.location) + '<br>' +
      '<strong>Listing:</strong> ' + (request.listing_url ? '<a href="' + escapeHtml_(request.listing_url) + '">' + escapeHtml_(request.listing_url) + '</a>' : 'Not provided') + '<br>' +
      '<strong>Received:</strong> ' + escapeHtml_(request.created_at) + '</p>' +
      '<p>Review and add it to the guide when appropriate.</p>';
    GmailApp.sendEmail(recipient, subject, text, { htmlBody: html, name: 'VNIT Freshmen Guide' });
    var ack = UrlFetchApp.fetch(endpoint, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({
        action: 'mail_ack', id: request.id, mail_lease: request.mail_lease,
      }), headers: { 'x-restaurant-mail-token': token }, muteHttpExceptions: true,
    });
    if (ack.getResponseCode() < 200 || ack.getResponseCode() >= 300) {
      throw new Error('Email sent but request acknowledgement failed: ' + ack.getContentText());
    }
  });
}

function installRestaurantRequestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processRestaurantRequests') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('processRestaurantRequests').timeBased().everyMinutes(5).create();
}

function requiredProperty_(props, name) {
  var value = props.getProperty(name);
  if (!value) throw new Error('Missing Script Property: ' + name);
  return value;
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}
