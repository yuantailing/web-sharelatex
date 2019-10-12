/* eslint-disable
    max-len,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const settings = require('settings-sharelatex')

const httpProxy = require('http-proxy')
const proxy = httpProxy.createProxyServer({
  target: settings.apis.realTime.url
})
const proxyMod = httpProxy.createProxyServer({
  target: settings.apis.realTime.url, selfHandleResponse : true
})
const wsProxy = httpProxy.createProxyServer({
  target: settings.apis.realTime.url.replace('http://', 'ws://'),
  ws: true
})

proxyMod.on('proxyRes', function (proxyRes, req, res) {
  var body = [];
  proxyRes.on('data', function (chunk) {
    body.push(chunk);
  });
  proxyRes.on('end', function () {
    body = Buffer.concat(body).toString();
    res.setHeader('Content-Type', 'application/javascript');
    res.end(body.replace('"socket.io"', '"SHARELATEX/socket.io"'));
  });
});

module.exports = {
  apply(webRouter, apiRouter) {
    webRouter.get('/socket.io/socket.io.js', (req, res, next) =>
      proxyMod.web(req, res, next)
    )
    webRouter.all(/\/socket\.io\/.*/, (req, res, next) =>
      proxy.web(req, res, next)
    )

    return setTimeout(function() {
      const Server = require('../../infrastructure/Server')
      return Server.server.on('upgrade', (req, socket, head) => {
        req.url = req.url.slice('/SHARELATEX'.length);
        wsProxy.ws(req, socket, head)
      })
    }, 0)
  }
}
