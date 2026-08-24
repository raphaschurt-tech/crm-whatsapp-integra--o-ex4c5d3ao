routerAdd('GET', '/backend/v1/whatsapp/test-zapi', function (e) {
  return e.json(200, { ok: true })
})
