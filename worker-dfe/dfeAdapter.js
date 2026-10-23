/**
 * worker-dfe/dfeAdapter.js
 * Interface com a SEFAZ (NT 2014.002 - NFeDistribuicaoDFe) utilizando a API oficial de classe NFeWizard-io.
 * Causa raiz resolvida: nfewizard-io v1.0.0+ exporta uma classe default (NFeWizard = require('nfewizard-io').default || require('nfewizard-io')).
 * Métodos: wizard.NFE_LoadEnvironment({ config: ... }) e wizard.NFE_DistribuicaoDFePorNSU({ cUFAutor, CNPJ, distNSU: { ultNSU } }).
 *
 * MODO REAL AUTOMÁTICO:
 * - Sempre que a biblioteca carregar com sucesso, opera em modo 'real'.
 * - Fallback para 'simulacao' APENAS se o require/inicialização falhar, com log alto e visível:
 *   [DFE-MODE] real  ou  [DFE-MODE] simulacao (com motivo).
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const tls = require('tls')
const https = require('https')
const crypto = require('crypto')
const { XMLParser } = require('fast-xml-parser')

/**
 * Cache global da cadeia ICP-Brasil em memória
 */
let icpBrasilCertsCache = null
let icpBrasilPemBundleCache = null

/**
 * Lista embutida de CAs SEFAZ / SERPRO SSL oficiais (fallback de resiliência caso arquivos locais faltem)
 */
const SEFAZ_SERPRO_SSL_CERTS = [
  // 1. AC Raiz Brasileira v10
  `-----BEGIN CERTIFICATE-----\nMIIGrDCCBJSgAwIBAgIJANLVi0S/gZNCMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD\nVQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv\nIE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG\nA1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2\nMTAwHhcNMTkwNzAxMTkxNTU5WhcNMzIwNzAxMTIwMDU5WjCBmDELMAkGA1UEBhMC\nQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNp\nb25hbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNTAzBgNVBAMM\nLEF1dG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMIIC\nIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAk3AxKl1ZtP0pNyjChqO7qNkn\n+/sClZeqiV/Kd7KnnbkDbI2y3VWcUG7feCE/deIxot6GH6JXncRG794UZl+4doD0\nD0/cEwBd4DvrDSZm0RT40xhmYYOTxZDJxv+coTHdmsT5aNmSkktfjzYX4HQHh/7M\nem+kTOpT/3E4K6B7KVs9HkOT7nXx5yU1qYbVWqI0qpJM9mOTSFx8C9HiKcHvLCvt\n1ioXKPAmFuHPkayOcXP2MXeb+VRNjWKU4E+L2t5uZPKVx1M/9i1DztlLb4K8OfYg\nGaPDUSF1sxnoGk5qZHLleO6KjCpmuQepmgsBvxi2YNO7X2YUwQQx1AXNSolgtkAR\n5gt+1WzxhbFUhItQqlhqxgWHefLmiT5T/Ctz/P2v+zSO4efkkIzsi1iwD+ypZvM2\nlnIvB24RcSN6jzmCahLPX4CwjwIK6JsSoMVxIhpZHCguUP4LXqP8IWUZ6WgS/4zB\n7B9E0EICl2rM1PRy+6ulv+ZOW256e8a0pijUB+hXM1msUq9L92476FAAX8va3sP7\n+Uut94+bGHmubcTLImWUPrxNT7QyrvE3FyHicfiHioeFL2oV4cXTLZrEq2wS8R4P\nKPdSzNn5Z9e2uMEGYQaSNO+OwvVycpIhOBOqrm12wJ9ZhWKtM5UOo34/o37r5ZBI\nTYXAGbhqQDB9mWXwH+0CAwEAAaOB9jCB8zBOBgNVHSAERzBFMEMGBWBMAQEAMDow\nOAYIKwYBBQUHAgEWLGh0dHA6Ly9hY3JhaXouaWNwYnJhc2lsLmdvdi5ici9EUENh\nY3JhaXoucGRmMEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9hY3JhaXouaWNwYnJh\nc2lsLmdvdi5ici9MQ1JhY3JhaXp2MTAuY3JsMB8GA1UdIwQYMBaAFHTzfv/8n1N6\n8Xzrqz6kptoYukVjMB0GA1UdDgQWBBR0837//J9TevF866s+pKbaGLpFYzAPBgNV\nHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQ0FAAOCAgEA\neCNhBSuy/Ih/T+1VOtAJju85SrtoE3vET1qXASpmjQllDHG/ph7VFNRAkC+gha+B\nCbjoA5oJ/8wwl+Qdp1KGz6nXXFTLx3osU+kjm0srmBf9nyXHPqvFyvBeB0A7sYb7\nTmII9GKD20oCxsdkccR/oE/JuTaNnGq0GYZ2aDb5v62uLi21Y6P9UBiTxZqQ4ojW\nET6kXNjlK238jpXv17FR8Sg3VusCvX7Q8eJkavvHHZDeWck2fSA+ycAc2JeL2Z0B\nMSxGWpH32WM9J8+6XqCJUXHiWEV0zCE8wDYiYC+047pTxQI/gB/FcU7jvylh98DJ\nkQPHd/Tp6Og3ynlDA9n9uBbxYHVRZs9vsZ/7xTFaxRe+zk8dhgKgZ/3RrcMFB570\n2t8LFbyuUE/kQVY6rZ0QJ9qMWQ7VPLRwRhiMeU3k8WDJb/tBbOXHBqldTbWyQ+mp\nMEDWhbrzE/IED82wAuO23Tb05cYk2xC7+Izef8fSc3XdJDuPSbcDpWukzyCDtSEH\nisLiGEtIbYRiPsF3czlQPsnIEVoTTCWxHCH1zYR6zScSv18Qh69qVe2J40K5jZoP\nGEOhq/oKhVJQAdvAFW5Odp7mF3Tk9nivjjsctJSxY26LFiV5GRV+07SSse4ti0aO\njO5PLg5SWjfcOtBG2rz02EIvQAmLcb0kGBtfdj0lW/w=\n-----END CERTIFICATE-----`,
  // 2. AC SERPRO SSL v1
  `-----BEGIN CERTIFICATE-----\nMIIHAjCCBOqgAwIBAgIJAJVIeKgiEmNTMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD\nVQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv\nIE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG\nA1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2\nMTAwHhcNMjAwMzEyMTkzMTQyWhcNMzIwNzAxMTIwMDU5WjCBjDELMAkGA1UEBhMC\nQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxNTAzBgNVBAsMLEF1dG9yaWRhZGUgQ2Vy\ndGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMTEwLwYDVQQDDChBdXRvcmlk\nYWRlIENlcnRpZmljYWRvcmEgZG8gU0VSUFJPIFNTTHYxMIICIjANBgkqhkiG9w0B\nAQEFAAOCAg8AMIICCgKCAgEA61jQVBX27GVzyZkJuyrEezqjBGdLSJDFRyGdwxbm\n8Ntr0AA8blhDaN5ASDOjqDESMA7xF38znfkZWBMLxJ3Ob0271W6G9bqgTwp/svhZ\ns91UcbZW6sB7gyxzMTGWLxcFMeBrurM0QpMVsp8hDH5Suv5rfP0YB9brz60k104u\nHG625rAcbRKHn7XsWJ1ZUQcwRzx1g0L1NlUKpsk0+eOAxTcVSVRTO33k+n6Gve83\n4MXMiG6Orved4isnEvQnl4AecCXOuUuM3vXZ+kdJGTpNy1HOy0coFdKCJSSCxU/y\nTbTiAiRJTc8rbvor3I7k7wR4ZDR8alDbW/Sbw1JEMtbQqMOXEOV7iEUIub0/uNT2\ng0oM4pu8DAxhIwy2YQCpjfCbzYu2bf1nabuOEQ2B4mFt/zgoxa5FLsM+0IjpCi8u\nz9RqLvYFo9pIy5BTi7JMkVfbgqcOv7vkQf3xF7sODdInCVRIbB0R6xpHm+bpitx9\nt5ip+Sf24QFlKbjy0gwVAnaEyf/iQF+t8qgcFBO65kyfH/2vs6iYg5TNhFKtjpqQ\niTyI7YkRkfTbLFdcgZbiRUUs5TFi0BkS4PAWupO1GgV9sJdk9gm3Z+KNZDgoAnu7\nCvhq1JXt6t7qO96WzBx9q9hi7T6eld1VFrV5Ya5kxM9Lgh+XcBDwfnDLI1Yoozbd\nMbkCAwEAAaOCAVcwggFTMIGtBgNVHSAEgaUwgaIwTwYGYEwBAYEJMEUwQwYIKwYB\nBQUHAgEWN2h0dHBzOi8vcmVwb3NpdG9yaW8uc2VycHJvLmdvdi5ici9kb2NzL2Rw\nY3NlcnByb3NzbC5wZGYwTwYGYEwBAgFpMEUwQwYIKwYBBQUHAgEWN2h0dHBzOi8v\ncmVwb3NpdG9yaW8uc2VycHJvLmdvdi5ici9kb2NzL2RwY3NlcnByb3NzbC5wZGYw\nQAYDVR0fBDkwNzA1oDOgMYYvaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJy\nL0xDUmFjcmFpenYxMC5jcmwwHwYDVR0jBBgwFoAUdPN+//yfU3rxfOurPqSm2hi6\nRWMwHQYDVR0OBBYEFK0WT0vxDL7CiqKFGNcNRiWTIuPNMA8GA1UdEwEB/wQFMAMB\nAf8wDgYDVR0PAQH/BAQDAgGGMA0GCSqGSIb3DQEBDQUAA4ICAQCDvWkOYakalAHB\n3ZcifI9yLyuTtjR8eYXlfDesYr7zMFVlmduVghCgueBMZxmht9BpLq9/ceBWu1q8\nsKge5oNNyySPmBJFe+CLjtB7Z1Ljk0Q/7A59lMCDZajojJlSEnH6pdhxA1JD58E0\ndGsom3SufuBWxdNfgsvpQNXDoKp48VlkyL4DKFCdJExtzuR5IlcQbB1FrmB5m2zo\nGG6j7UdoevmikIv01la+8kyn7CF5aNubRE0cfwxulik5LNM1uLIwfUVwYbbQiB8z\nbaLUOS2lU/pYr+seLQ7VBPHps/guGB9hKei/Df49KWjDVplu3+AuZhBHqiK533VJ\nf9Uwv3Rvx8FCobT54OCrAVfnFs8F6sM3dPh1u7AbW3Ddpeo4oBH5kBA0feLvLk7v\nmOnOq64oPMMoj+g6x0B0v7tGqOrNBZK486MaU/uaJi+omx+Le9EfyIz39BbRYGdV\nJvO/9P8vn5XnNXsmqziw08ENLjHcrro48tRm3YX0/BUgoitjMUqyzlKTgQ8UOpfi\nXeJzqvxvUMO/HgZK9aknN3WQXWXxIFG01OHsEOTd2Nddqbrth5qmZE+1IxwEH+ys\nQQzlV0pnPL5K0bRuPCqvH4Jr0CmwV2PqD6dkjI/Sy77XDkTP8adAuYjIEynBoQ0b\ntqY/0rJPT3dztepWAwRHhKbvO1yYkA==\n-----END CERTIFICATE-----`,
  // 3. AC Raiz Brasileira v12
  `-----BEGIN CERTIFICATE-----\nMIIGrDCCBJSgAwIBAgIJAOGP9LYdB70PMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD\nVQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv\nIE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG\nA1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2\nMTIwHhcNMjQxMDIyMTQ0MTI0WhcNMzcxMDIyMTIwMDI0WjCBmDELMAkGA1UEBhMC\nQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNp\nb25hbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNTAzBgNVBAMM\nLEF1dG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEyMIIC\nIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA5PolCsI88igf+CyoE7HeF4sv\nWLSCE/C9XO+en7Uj6J5+zYu/G1k2kHXMvHeOrNOK67FHxXc9n/3uhqbmJYVfm77W\n3Ds7dIXRhDf86x7tRIQXB9biea9NAuXcgelIw1QLwi2lF3ACdaqEfN+fdYDO6pHC\nK1FCEjfIld1bNSvcUB/ah4DzPjEkJPrToYo2s9J5R6NEuzBpf0HluB+Xi/9km6OS\nPeJPepCCNxVsnshbOpQCCAtsoSx6zxeOWZ8WeVHWk/RZiFSNMkaJSPdlVfRkCOdv\ngK5nhBpLSU1giO98HDrho3FxR3mjPQ2sSda7E7fE2IqP4xTtnS4sz5Ug9bZxcVDK\nX58ysavZPRj2Qh+vooxbGItRRZq81XsOhutk+p0o6HgGh4JxnmpuUdhsUQayoc/Z\n7AsPHpe7NTiiJfkSIXJk3mGsrHrsh66n4SIEijKyhcykDDmSbPiLPG1IO8B9awUI\nYMsOeVDFei95IEK6CbKhIOqTzlcgQzQ9YVXOzqzJ1Ok53RQq5CDcX0XAH/eJiWRy\nWqvyyLA1N9i46cfRF9hK/Ws/TyrM7kjp795VmjP+hnLqA4vJtx1uNApok24TUPDB\n6YLA1yb9ITz8qbcwJ1KvhgWZzWu5m8tZ+3X2OjFZDuSUo5LtyOAiEurREE50QwFl\nD/pOoTNNVTZ4C6Hfr3sCAwEAAaOB9jCB8zBOBgNVHSAERzBFMEMGBWBMAQEAMDow\nOAYIKwYBBQUHAgEWLGh0dHA6Ly9hY3JhaXouaWNwYnJhc2lsLmdvdi5ici9EUENh\nY3JhaXoucGRmMEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9hY3JhaXouaWNwYnJh\nc2lsLmdvdi5ici9MQ1JhY3JhaXp2MTIuY3JsMB8GA1UdIwQYMBaAFGrBeteSwbpp\nTtbi88KZhIm+VXQOMB0GA1UdDgQWBBRqwXrXksG6aU7W4vPCmYSJvlV0DjAPBgNV\nHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQ0FAAOCAgEA\nFdInyigGs5T9LIzxQp9bDaAjmyIeB/LkRHlVYVedlKGIX2lTbLEKtlc/z+/dYi9v\nlFxhb1xuOgDFt/Cu1lHUm/U9RVtn5HimLbYtA7TQD5FN1Jdgf24k8zwQXTa2Rv93\njD3R3JmI0/mTSXEUTgyDzPwKnxxZIi4vltJYNqBhwaVH2+aA1FZpDWlx8iB8bKGG\nL7yw2+0baEuCKuxzBKaZTZwmAHbmvFys2hrTdCr/znz4yg8613WU8ebMNYDl2Ojf\njBCWcpcCAsSuO+A9I+DWtxdIG9Q2DaQzXXrXrbU6cdZGMQoPogslZIYvLOnaAalh\njmNz4Yq5COBJ2cXapriMmCw+TJj/j4/SKB2EDaDzfRNY+Pea0tMHCt9bXlaSnumJ\nT6d6ZIyQYmRnjNp+pf6Wfg9r6yiTeldfo+QnzOqn0nRwh+ltMzMfdsyZ8CiNTf60\nEV4+I1pPLyZn+9nC68i4OFGYzmtO91E4/YTET2HoTIGISkcMobPdnIBW+fU8afkc\nIAFEJOXdl2RzFX8DuUCHtQXVmBV5DdX04SAYIqiwUtbCnUVD344sAdY8AgjpiTR8\nfryJ2NmkY2srZh/RHz+VG9Fxv4hLPdajws60RXU0Nipau8hCqDpS7mHP2IeujLbL\n6sxQa2iPlKWyI3ZsA+W5zVbDmNx5Lnh785pEVk8hhPg=\n-----END CERTIFICATE-----`,
  // 4. AC SERPRO v5
  `-----BEGIN CERTIFICATE-----\nMIIGXjCCBEagAwIBAgIJANG8WFDjRHdzMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD\nVQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv\nIE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG\nA1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2\nMTIwHhcNMjUxMTEyMTQwMTIxWhcNMzcxMDIyMTIwMDI0WjCBhjELMAkGA1UEBhMC\nQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxNTAzBgNVBAsMLEF1dG9yaWRhZGUgQ2Vy\ndGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEyMSswKQYDVQQDDCJBdXRvcmlk\nYWRlIENlcnRpZmljYWRvcmEgU0VSUFJPIHY1MIICIjANBgkqhkiG9w0BAQEFAAOC\nAg8AMIICCgKCAgEAvghdFFgeqnZ4CTcH9jhm1K/+THudL7B0gHn59IN8XI9zBAND\niyUATWvSuK0qeDFRU6JFJkGjD6ljzqI0WQzPhmRpD9TDQkmu5arVLG73aIGfIMJS\nXb/VTZ8ac6RjHKlOQDZ9e1Tt3km4ZfWYGB85iVoEyiPOifx8WlEtOYkJuxgN6TBu\nGxqb5kbJIsVrfmcP8IHpT6s8VUrEX53Z/OxZhDeppoyrj0k3cf8qEqqvcBeI0c8f\ndG2ugEijeiwjROk3tNXra/wiM1afcXMgzD/yLZehel2mQxqE6BYItET3vBesLv6b\ntNXo0OL3kaxtI5jxtaU7Ku3wEQLW8Wv+0G3uL2KjrnPOJKaW8TktlAIWNhKbvmOi\naxG1kqEbhBTmuO86Nc0zD3iP1eWVQBenKQnJChCu+tF4HEGjwaJSUQ9ybhJpU62o\nRztezrSkLy0a/QgevhejqCRHv9rsRVhgFhtr5Tm/7LULwv4S4Mp+cNUpY1fn4AB9\npBH9GH/b7ixU9i2pTXoQyGq8cm0JVJLXa8ghIu2dg7yNFtJWz5mqxc0DXW6Ayuv7\nCWZIfjeiUEw+sA4lN/ZlJ26ORAIvK9/g7VeWpZ7B9rwUsGGOB9QXxhJNJCYB33VK\nxGepDfPcgtYsxSwRQdPu176nMpqil89rtZdhRtRC44mDuWkUWUH+YkWzA+sCAwEA\nAaOBujCBtzAdBgNVHQ4EFgQU8a12lhTtPj1eGl80RnXWyk87vsMwDwYDVR0TAQH/\nBAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwEgYDVR0gBAswCTAHBgVgTAEBAjBABgNV\nHR8EOTA3MDWgM6Axhi9odHRwOi8vYWNyYWl6LmljcGJyYXNpbC5nb3YuYnIvTENS\nYWNyYWl6djEyLmNybDAfBgNVHSMEGDAWgBRqwXrXksG6aU7W4vPCmYSJvlV0DjAN\nBgkqhkiG9w0BAQ0FAAOCAgEAdzmd93g+vbPj/OyLRgxEqEh1nMDmMCvU6bVFck5C\nwBFXspV0ChaL3qsIhiR24ZoAD0CRY1sXudYFOyUMc1dzz9x0bKtciZ/eAhx2OEYH\ndO/qdGmZ2fZ4xhiaACziRpSvqSAO5+eeJx2p+JVTtvJE3pXW12GI58mA1rk61vMZ\n3TBDzTTWbIY7vQtPdDszk7QqJFc8gu8uBp5Xa7fzx3cHyKLeMonhF/6a3NrtBohj\nu9/Rln4SrxUpD4hKTyTJcCcNmojxpxpnwYKeKbtpcyr25259GCr3KHOhNK18pkDi\nbyy0HMfcdinR11283I2qKZ758yyBSaO4qyKgxo5g+rBnFqQkA6yV/8tQEKbBqUYb\nFGFwhABev6UKw3rIbFPLo4zY9GfEnu315OtTLvn/5uHkHWKkSlXAvmxXGeBibija\noOqLgAGiYzbtOim7hPF2RP9UIAph0PBnHGclk4fUtJ6sdvFUSjhdqMtMljJx4v2L\nij1AOQRoXzLO3mPC8CBkd0VM/ID/Xo/GZgSXcmQj02Gcfw9X463kiUTm3sUflTXE\nGjcUlJ4qgnZx5Gh18XN9mSGs9y9KEiJ8QwBw+Ld6mccDLQeaOMJzxLCKqkr9lm9a\nlmlYrC6FkIs5ISOiW5qDlTialDkbnrXpiAVYOSGIiepCtk7hm1JZb4MD+GXg0x97\nIPY=\n-----END CERTIFICATE-----`,
  // 5. AC SERPRO Final v6
  `-----BEGIN CERTIFICATE-----\nMIIHjjCCBXagAwIBAgIIE65IPZKGnyEwDQYJKoZIhvcNAQENBQAwgYYxCzAJBgNV\nBAYTAkJSMRMwEQYDVQQKDApJQ1AtQnJhc2lsMTUwMwYDVQQLDCxBdXRvcmlkYWRl\nIENlcnRpZmljYWRvcmEgUmFpeiBCcmFzaWxlaXJhIHYxMjErMCkGA1UEAwwiQXV0\nb3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFNFUlBSTyB2NTAeFw0yNjAzMTcxMzUxMTha\nFw0zNzEwMTExMzUxMThaMIGVMQswCQYDVQQGEwJCUjETMBEGA1UEChMKSUNQLUJy\nYXNpbDE7MDkGA1UECxMyU2VydmljbyBGZWRlcmFsIGRlIFByb2Nlc3NhbWVudG8g\nZGUgRGFkb3MgLSBTRVJQUk8xNDAyBgNVBAMTK0F1dG9yaWRhZGUgQ2VydGlmaWNh\nZG9yYSBkbyBTRVJQUk8gRmluYWwgdjYwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAw\nggIKAoICAQDfIVc07q8T9lCVTYcyL//5shv0MOQxfGCVZFXXBOO8802YsV8fBLSy\ngjARK2XKKRb32dxAevQPavZPLunAuWFYZOVhKkdefPc5yIdifAPjyVdbWFoUHk87\nrzuuLe5tbKCgSNRPTJkIaLg7SRhaFkYm1VhgR7j68kJqi8EhTCdKVxlN+0bvTUSa\nBnnN1euRZRiJo37bL3xEMq1t84VZkwllEYoFK0rNJe9xxANg5+ys1scGEZYK9PH2\n9K7A1gvIr2hJyq6Uv0lf1Ohj0dyVpEps4AtYr1Rq1WJE5BLu5xOh5YO6wfn8zOoO\nZThAktGJW6cQaNTiP+fA9YGLnrWmySZ8zsHnqGobt7WrHv3fIFGFETSWqVm1GIug\nhPaItJFSZySXr8eca6Jcptc1iEJu5biDlU+HxJS5KxaPDzA0eZfV0BBJC7GlPlZe\npR7k+kOJ7EIVIydUKqQ/P+qTcgOYI2Q54d/OJL+me9PLm0DVLnxV0xgAwFDO0XN6\nZOrsEOMsbzW/AxOXPEwQ1yDbtlrGfB0+e9w3rDf3uUMqjyEnNr2HzJWDjtmw1Qrq\n+MKQIjq8GjfJ19D8vOp1ilTMPaqn0RE7gnRzsahnPCGoWKU4Z8VVMxNO4OZ7Tk+X\niH2tJ41vub5GyShPRyly+wYUTMjuSG/DwVV7N5uJdAPc9H+OZPh24QIDAQABo4IB\n7TCCAekwggEABgNVHSAEgfgwgfUwTwYGYEwBAgMNMEUwQwYIKwYBBQUHAgEWN2h0\ndHBzOi8vY2NkLnNlcnByby5nb3YuYnIvYWNzZXJwcm8vZG9jcy9kcGNhY3NlcnBy\nby5wZGYwUAYHYEwBAoFJEjBFMEMGCCsGAQUFBwIBFjdodHRwczovL2NjZC5zZXJw\ncm8uZ292LmJyL2Fjc2VycHJvL2RvY3MvZHBjYWNzZXJwcm8ucGRmMFAGB2BMAQKB\nSg0wRTBDBggrBgEFBQcCARY3aHR0cHM6Ly9jY2Quc2VycHJvLmdvdi5ici9hY3Nl\ncnByby9kb2NzL2RwY2Fjc2VycHJvLnBkZjCBgQYDVR0fBHoweDA5oDegNYYzaHR0\ncDovL3JlcG9zaXRvcmlvLnNlcnByby5nb3YuYnIvbGNyL2Fjc2VycHJvdjUuY3Js\nMDugOaA3hjVodHRwOi8vY2VydGlmaWNhZG9zMi5zZXJwcm8uZ292LmJyL2xjci9h\nY3NlcnByb3Y1LmNybDAfBgNVHSMEGDAWgBTxrXaWFO0+PV4aXzRGddbKTzu+wzAd\nBgNVHQ4EFgQU6OO83K8EOdIf+CNSOmXKpldoOsUwDwYDVR0TAQH/BAUwAwEB/zAO\nBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQENBQADggIBACFAOLOtMYCBjt+pzQ7E\nPTwDBTtaKumDyn2NbR44rjUvFN6mgjtVLN00DPKnOHD14ugraXwapZSmEZCfS6fA\nhoEixKA/casKJc+IL6nwfdLYCute74iaeCiT54mxW7oHU05wB3AzHJcOkoZTxCII\n0vv1x23gkghTtLM5Q3W+0oGApMpi1oThLr2OKx0u4Hvqrkd9axotogJJx/MJRWAn\nOighxmMSxPxAKnkN2GnYhOUjSW6aIXEsDoyEvXJl6eBSmrO9RWEf8DwgbDwHY/aG\nu/mRq29qSU5coe0Mj7uejm3Zvx4akym/9bt5+FVjt5ArMUqGdzIyVQt55CGVdKAB\nEL2EmxbSNn3pB/zMsDr0DfMZPkUH8L2vKMEfd1m5X0s+AZgb2wrGmQJQssFG3VbA\nV1x3GHxdoQXsT5Bb6WyJ7416R3d4BEcTsTrUPjz2m3A5MEIjGU9lCblmNMIyKeI4\n+G+yl2ZgH63CvwfQMTAy1dpll4yfPqL0tV0MsHwCFxMiAiZk37l4PY08Hpnk5CDf\n1FwuAQEGvWw9GHfMCbGbOCUUgkCJ+gU1WEA0D6HxL1h0968+2ONrK2YQaffBQxDT\nzJFtHvF0FGPHlIbjhsTLm9NJ9FOZz2zDXAvEWTDkOTwLa+BoEPxEhwDc+Sv5AQ8k\n0n2YViuenAVn0O1wKoRwYCG1\n-----END CERTIFICATE-----`,
  // 6. AC Raiz v5
  `-----BEGIN CERTIFICATE-----\nMIIGoTCCBImgAwIBAgIBATANBgkqhkiG9w0BAQ0FADCBlzELMAkGA1UEBhMCQlIx\nEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNpb25h\nbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNDAyBgNVBAMMK0F1\ndG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjUwHhcNMTYw\nMzAyMTMwMTM4WhcNMjkwMzAyMjM1OTM4WjCBlzELMAkGA1UEBhMCQlIxEzARBgNV\nBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNpb25hbCBkZSBU\nZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNDAyBgNVBAMMK0F1dG9yaWRh\nZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjUwggIiMA0GCSqGSIb3\nDQEBAQUAA4ICDwAwggIKAoICAQD3LXgabUWsF+gUXw/6YODeF2XkqEyfk3VehdsI\nx+3/ERgdjCS/ouxYR0Epi2hdoMUVJDNf3XQfjAWXJyCoTneHYAl2McMdvoqtLB2i\nleQlJiis0fTtYTJayee9BAIdIrCor1Lc0vozXCpDtq5nTwhjIocaZtcuFsdrkl+n\nbfYxl5m7vjTkTMS6j8ffjmFzbNPDlJuV3Vy7AzapPVJrMl6UHPXCHMYMzl0KxR/4\n7S5XGgmLYkYt8bNCHA3fg07y+Gtvgu+SNhMPwWKIgwhYw+9vErOnavRhOimYo4M2\nAwNpNK0OKLI7Im5V094jFp4Ty+mlmfQH00k8nkSUEN+1TGGkhv16c2hukbx9iCfb\nmk7im2hGKjQA8eH64VPYoS2qdKbPbd3xDDHN2croYKpy2U2oQTVBSf9hC3o6fKo3\nzp0U3dNiw7ZgWKS9UwP31Q0gwgB1orZgLuF+LIppHYwxcTG/AovNWa4sTPukMiX2\nL+p7uIHExTZJJU4YoDacQh/mfbPIz3261He4YFmQ35sfw3eKHQSOLyiVfev/n0l/\nr308PijEd+d+Hz5RmqIzS8jYXZIeJxym4mEjE1fKpeP56Ea52LlIJ8ZqsJ3xzHWu\n3WkAVz4hMqrX6BPMGW2IxOuEUQyIaCBg1lI6QLiPMHvo2/J7gu4YfqRcH6i27W3H\nyzamEQIDAQABo4H1MIHyME4GA1UdIARHMEUwQwYFYEwBAQAwOjA4BggrBgEFBQcC\nARYsaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJyL0RQQ2FjcmFpei5wZGYw\nPwYDVR0fBDgwNjA0oDKgMIYuaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJy\nL0xDUmFjcmFpenY1LmNybDAfBgNVHSMEGDAWgBRpqL512cTvbOcTReRhbuVo+LZA\nXjAdBgNVHQ4EFgQUaai+ddnE72znE0XkYW7laPi2QF4wDwYDVR0TAQH/BAUwAwEB\n/zAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQENBQADggIBABRt2/JiWapef7o/\nplhR4PxymlMIp/JeZ5F0BZ1XafmYpl5g6pRokFrIRMFXLyEhlgo51I05InyCc9Td\n6UXjlsOASTc/LRavyjB/8NcQjlRYDh6xf7OdP05mFcT/0+6bYRtNgsnUbr10pfsK\n/UzyUvQWbumGS57hCZrAZOyd9MzukiF/azAa6JfoZk2nDkEudKOY8tRyTpMmDzN5\nfufPSC3v7tSJUqTqo5z7roN/FmckRzGAYyz5XulbOc5/UsAT/tk+KP/clbbqd/hh\nevmmdJclLr9qWZZcOgzuFU2YsgProtVu0fFNXGr6KK9fu44pOHajmMsTXK3X7r/P\nwh19kFRow5F3RQMUZC6Re0YLfXh+ypnUSCzA+uL4JPtHIGyvkbWiulkustpOKUSV\nwBPzvA2sQUOvqdbAR7C8jcHYFJMuK2HZFji7pxcWWab/NKsFcJ3sluDjmhizpQax\nbYTfAVXu3q8yd0su/BHHhBpteyHvYyyz0Eb9LUysR2cMtWvfPU6vnoPgYvOGO1Cz\niyGEsgKULkCH4o2Vgl1gQuKWO4V68rFW8a/jvq28sbY+y/Ao0I5ohpnBcQOAawiF\nbz6yJtObajYMuztDDP8oY656EuuJXBJhuKAJPI/7WDtgfV8ffOh/iQGQATVMtgDN\n0gv8bn5NdUX8UMNX1sHhU3H1UpoW\n-----END CERTIFICATE-----`,
  // 7. AC Raiz v2
  `-----BEGIN CERTIFICATE-----\nMIIGoTCCBImgAwIBAgIBATANBgkqhkiG9w0BAQ0FADCBlzELMAkGA1UEBhMCQlIx\nEzARBgNVBAoTCklDUC1CcmFzaWwxPTA7BgNVBAsTNEluc3RpdHV0byBOYWNpb25h\nbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNDAyBgNVBAMTK0F1\ndG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjIwHhcNMTAw\nNjIxMTkwNDU3WhcNMjMwNjIxMTkwNDU3WjCBlzELMAkGA1UEBhMCQlIxEzARBgNV\nBAoTCklDUC1CcmFzaWwxPTA7BgNVBAsTNEluc3RpdHV0byBOYWNpb25hbCBkZSBU\nZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNDAyBgNVBAMTK0F1dG9yaWRh\nZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjIwggIiMA0GCSqGSIb3\nDQEBAQUAA4ICDwAwggIKAoICAQC6RqQO3edA8rWgfFKVV0X8bYTzhgHJhQOtmKvS\n8l4Fmcm7b2Jn/XdEuQMHPNIbAGLUcCxCg3lmq5lWroG8akm983QPYrfrWwdmlEIk\nnUasmkIYMPAkqFFB6quV8agrAnhptSknXpwuc8b+I6Xjps79bBtrAFTrAK1POkw8\n5wqIW9pemgtW5LVUOB3yCpNkTsNBklMgKs/8dG7U2zM4YuT+jkxYHPePKk3/xZLZ\nCVK9z3AAnWmaM2qIh0UhmRZRDTTfgr20aah8fNTd0/IVXEvFWBDqhRnLNiJYKnIM\nmpbeys8IUWG/tAUpBiuGkP7pTcMEBUfLz3bZf3Gmh3sVQOQzgHgHHaTyjptAO8ly\nUN9pvvAslh+QtdWudONltIwa6Wob+3JcxYJU6uBTB8TMEun33tcv1EgvRz8mYQSx\nEpoza7WGSxMr0IadR+1p+/yEEmb4VuUOimx2xGsaesKgWhLRI4lYAXwIWNoVjhXZ\nfn03tqRF9QOFzEf6i3lFuGZiM9MmSt4c6dR/5m0muTx9zQ8oCikPm91jq7mmRxqE\n14WkA2UGBEtSjYM0Qn8xjhEu5rNnlUB+l3pAAPkRbIM4WK0DM1umxMHFsKwNqQbw\npmkBNLbp+JRITz6mdQnsSsU74MlesDL/n2lZzzwwbw3OJ1fsWhto/+xPb3gyPnnF\ntF2VfwIDAQABo4H1MIHyME4GA1UdIARHMEUwQwYFYEwBAQAwOjA4BggrBgEFBQcC\nARYsaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJyL0RQQ2FjcmFpei5wZGYw\nPwYDVR0fBDgwNjA0oDKgMIYuaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJy\nL0xDUmFjcmFpenYyLmNybDAfBgNVHSMEGDAWgBQMOSA6twEfy9cofUGgx/pKrTIk\nvjAdBgNVHQ4EFgQUDDkgOrcBH8vXKH1BoMf6Sq0yJL4wDwYDVR0TAQH/BAUwAwEB\n/zAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQENBQADggIBAFmaFGkYbX0pQ3B9\ndpth33eOGnbkqdbLdqQWDEyUEsaQ0YEDxa0G2S1EvLIJdgmAOWcAGDRtBgrmtRBZ\nSLp1YPw/jh0YVXArnkuVrImrCncke2HEx5EmjkYTUTe2jCcK0w3wmisig4OzvYM1\nrZs8vHiDKTVhNvgRcTMgVGNTRQHYE1qEO9dmEyS3xEbFIthzJO4cExeWyCXoGx7P\n34VQbTzq91CeG5fep2vb1nPSz3xQwLCM5VMSeoY5rDVbZ8fq1PvRwl3qDpdzmK4p\nv+Q68wQ2UCzt3h7bhegdhAnu86aDM1tvR3lPSLX8uCYTq6qz9GER+0Vn8x0+bv4q\nSyZEGp+xouA82uDkBTp4rPuooU2/XSx3KZDNEx3vBijYtxTzW8jJnqd+MRKKeGLE\n0QW8BgJjBCsNid3kXFsygETUQuwq8/JAhzHVPuIKMgwUjdVybQvm/Y3kqPMFjXUX\nd5sKufqQkplliDJnQwWOLQsVuzXxYejZZ3ftFuXoAS1rND+Og7P36g9KHj41hJ2M\ngDQ/qZXow63EzZ7KFBYsGZ7kNou5uaNCJQc+w+XVaE+gZhyms7ZzHJAaP0C5GlZC\ncIf/by0PEf0e//eFMBUO4xcx7ieVzMnpmR6Xx21bB7UFaj3yRd+6gnkkcC6bgh9m\nqaVtJ8z2KqLRX4Vv4EadqtKlTlUO\n-----END CERTIFICATE-----`,
  // 8. AC SERPRORFB SSL
  `-----BEGIN CERTIFICATE-----\nMIIGoTCCBImgAwIBAgIBGzANBgkqhkiG9w0BAQ0FADCBkDELMAkGA1UEBhMCQlIx\nEzARBgNVBAoTCklDUC1CcmFzaWwxNDAyBgNVBAsTK0F1dG9yaWRhZGUgQ2VydGlm\naWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjIxNjA0BgNVBAMTLUFDIFNlY3JldGFy\naWEgZGEgUmVjZWl0YSBGZWRlcmFsIGRvIEJyYXNpbCB2MzAeFw0xNzA2MTkxOTA1\nMDhaFw0yMTEwMTAxOTA1MDhaMIGOMQswCQYDVQQGEwJCUjETMBEGA1UECgwKSUNQ\nLUJyYXNpbDE2MDQGA1UECwwtU2VjcmV0YXJpYSBkYSBSZWNlaXRhIEZlZGVyYWwg\nZG8gQnJhc2lsIC0gUkZCMTIwMAYDVQQDDClBdXRvcmlkYWRlIENlcnRpZmljYWRv\ncmEgZG8gU0VSUFJPUkZCIFNTTDCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoC\nggIBALGlN3qImQR5VCac9sdj1nrA9h7KXiyh58fmIYx+fF5Eo96urVKuRoYPxKB+\nIRqVSbSdhdmO+2b7qXK3N99p1/WuTHPl+m1tS8rOzwExR/d5l3W7dnnVDSWlt8Jy\n+zLnM+TX/jHtAfs5CPskidnBspCHP/6oVNwNNTwB+oOGxImsGafMGKhY92t8nSDW\nPZ+peNUegf0wR/ZRjbdvZSg57lxRym2lW2Cj4ZIwuT2/j9g41f7p6q35r2JdaPyl\nOHQ6JkZVMVKCQ61UFLWtN8cHjKynTmAFloDkCRFxrtKnIE12KpCVy8Hpd32SkU7T\n08Kgwq54t5/8sqJ5iqHpIFg/I/Un3viSmDRCzwMOwJzn7tLf04qKUWE2KQeOHSSA\nINctOx9aKQIHR1Vhpec0QbPzN4gqIsh+mQ3FJ+j6l6yfV2E3eiz5f58+kl/S88ul\nOOddsX9F+a+9Vg44IyObADNOtc+cnASSf3AOsow5USumb9Wp8qaHcRRzUl1lBPxQ\nbQQ8U/vhYrArnRKWEeJxktPGLA+Lfa2KEPYzWqmoNtiAfYD1O58YRCiRCAvnfIDA\ns55IWy90zo28G1A+GvaYZCgbVOBRyjJJmmoMK2eLETxjyG17Hr5TJSwe7A38gNff\nsOuVk095OuZmeQil/LqqUSds5pHhaUzZOpq6iVOlSE5nHfAtAgMBAAGjggEEMIIB\nADBXBgNVHSAEUDBOMEwGBmBMAQIBWzBCMEAGCCsGAQUFBwIBFjRodHRwOi8vd3d3\nLnJlY2VpdGEuZmF6ZW5kYS5nb3YuYnIvYWNyZmIvZHBjYWNyZmIucGRmMEQGA1Ud\nHwQ9MDswOaA3oDWGM2h0dHA6Ly93d3cucmVjZWl0YS5mYXplbmRhLmdvdi5ici9h\nY3JmYi9hY3JmYnYzLmNybDAfBgNVHSMEGDAWgBR1y7qQ0c5Mp5LwcbDLvrh7Mway\nKDAdBgNVHQ4EFgQUII0RXFXDAW+rVvGDzGipq8LatWMwDwYDVR0TAQH/BAUwAwEB\n/zAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQENBQADggIBAMCM7C1u8k+LDCPF\nVpJG6DGV7TuRaczA2oOJwuIktcGz3Q9yACGznhsDLMSF6DQxUUTePKJbQ2TXlOAL\ncL6afrUl02a6cFXt2cWylWRX0FfKiEFArhLcRayvQJt+BGeeVS6psABSPb4IHZ0u\nuQ0+YUt+tOcpeczIO+kDUPusFdH+Y9TTn4UZYChlaox8LqXp+wDizqVdrFZHShmw\n+9qOTEuTFMmHKqSsyJaOUoZuucXEdp8tuOjaT5OLm1mhiXIdwQg375eR2YmTWzHP\nXDs3R1kFY4rL5M791pn0LDOswZJuCrnPgrEoed4uMZ1hJBD4nN+UsjB7cUZqghwA\nrKOMT/SNi8L0GlUU1yQnwlQidUZMHZU1ZjEG8Y7igwe87BAdwc5Jy2YLJpS9qr0w\n2Xw3IfgHpjtxm0NAYQDL2dqzq14co7hg/GrWNVgnppW8QlFirVYCDAPGK2mpemXk\ns12/f6dZfHd9qAvDG9C8+ecnttRyFuUzIcl5PJT5qHmwtm8z2AItnRSNptgWii1t\nxG+rbSajzDk+BEA5ATOnQdqoQbU7lmFyWd42L73C0dN+aeqOC4UZk3drjOT7Govd\n0PCMMKm3q4NyGRRCuMyi8YIx//mJfekyZOXqibStxgoO9otsiZzVt6yJPXdgeSUb\nprH2k7cA+R0svaCxaLxlEu1xj8uO\n-----END CERTIFICATE-----`,
  // 9. AC RFB v3
  `-----BEGIN CERTIFICATE-----\nMIIGYDCCBEigAwIBAgIBCDANBgkqhkiG9w0BAQ0FADCBlzELMAkGA1UEBhMCQlIx\nEzARBgNVBAoTCklDUC1CcmFzaWwxPTA7BgNVBAsTNEluc3RpdHV0byBOYWNpb25h\nbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNDAyBgNVBAMTK0F1\ndG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjIwHhcNMTEx\nMDIxMTIxNjI5WhcNMjExMDIxMTIxNjI5WjCBkDELMAkGA1UEBhMCQlIxEzARBgNV\nBAoTCklDUC1CcmFzaWwxNDAyBgNVBAsTK0F1dG9yaWRhZGUgQ2VydGlmaWNhZG9y\nYSBSYWl6IEJyYXNpbGVpcmEgdjIxNjA0BgNVBAMTLUFDIFNlY3JldGFyaWEgZGEg\nUmVjZWl0YSBGZWRlcmFsIGRvIEJyYXNpbCB2MzCCAiIwDQYJKoZIhvcNAQEBBQAD\nggIPADCCAgoCggIBAMFyHLTC/E6bRxhdNYhePQ9um1dASSkb6+2i8Ss0kfSEAm3K\nfmWDUxLpHaAKP2xR2NT8ju1Kpq6Mns1tZmso3VzcacHS3X5nagP/I+jwJIV+GftJ\nEp+iiPv1EkiF8hMksXk3vOaHPOA/TNpmmU/nyEB5jNSwEwwych2RTb0IvNr3bV62\noJecNNJIu+ws7Z4Rs9Wot0F13lCrVm0KRLHj2llcgu67ArTsFlkDhKNZbS3ohFuc\nGIlVlkIg/B0E2MjARjos21QJHaYcRmr2w9rF1uZkylUtbn4wYWsj5kt9BCthcjgK\nKl2oVZB9agIS0AgUcfaoia8tsl7F63l/aa2kQ9UcQewBbORR4TZPGJSKbItKylP8\n/EN86u3rPI7nsmJn6HuMVl53hhLKNupP7mtrUZHC3w2FBvD3/JNiKJaP08GFjLH6\nvEiaR2m9YhizvJUXnDL9yFbkRHU+1lDssdnVDRSNVQX1tK0IpeRAMTHz60e1yJq+\nSrGNypEOSlFdeD05xFzIjUbpKQe4Obml9wvBHF9FT2evGxknWOFxda0frZzl0UOK\n70++BSfe6BZ9UwHKXhyjOazPoXEzRK7w6fHYlGjY5XkQ6Y9qNCt6lu80zy6vAxQ/\nf1Y3w9b+ArawqyTVtb9AtcJsAxhtBf/9njiE1dSTYve5D5S94zNiIWtpDxzbAgMB\nAAGjgbswgbgwHQYDVR0OBBYEFHXLupDRzkynkvBxsMu+uHszBrIoMA8GA1UdEwEB\n/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMBQGA1UdIAQNMAswCQYFYEwBAQgwADA/\nBgNVHR8EODA2MDSgMqAwhi5odHRwOi8vYWNyYWl6LmljcGJyYXNpbC5nb3YuYnIv\nTENSYWNyYWl6djIuY3JsMB8GA1UdIwQYMBaAFAw5IDq3AR/L1yh9QaDH+kqtMiS+\nMA0GCSqGSIb3DQEBDQUAA4ICAQCJiamFONQFDtlBuOkqfglnGYufeillnVGeH6TW\np7yPEuH9Hfdq/1oN38aJmpvoWnno3GY5U/wKPokFAIizK2kASwvWSpu9hRD1kS5F\np4Qlqt1Zsm6bUOlcAD9wZylp7s1lebSj7XiO6epF4OSdeBtKl9OImeF8dhyqPnWb\nj2IrjxEzyrZ+U+Lb4bFcBI6Lp6r1NHyun+TWD3jbCkBRpJLQt7uO+5asMZYEO+L+\nfuexEb2Bb8difS4ujPpdMlctg4wm6NHTcB008C+cMkwDpeBvaWpMOZLvDvENDhQW\n4HBNHNDMdVoIsvvoxSVabrNxp02CATP0y9RubIgkmX40H+R8OXy8Cq3oipSm1t4v\n/Ihs4aCtoDLZue3Q12RgqHNaKcuwTNoK5BH5AfEYRE2LYxQ/JVrlf1hJAu0fUe2n\nhv42+i35AJVWpRrEmBk6GLejpJ/QAF1fRmdb0b1+lSLXgOfw3AzFW+e+8BdwCF/0\n6FPOvapilPMa+bsL7aabinBZ7a4Kc97cMHEW5gkQL0IL6yxYnzALHajvZrrLxwvp\nzW/os3P2ztINB12cYAkDKf5nmo2ymDHY34IUfi1hPA8EEPkhozhi5Or/W6qRABsH\niSxrSEeSKLy4V34hkShPjDtl2Ob/aU1/8A5g5BSGPBpfm/TQJc7g7MrF67lRDoAh\nDikamA==\n-----END CERTIFICATE-----`,
]

/**
 * Resolve os possíveis diretórios onde a cadeia ICP-Brasil reside no ambiente
 */
function resolveIcpBrasilCertsDirs() {
  const candidates = [
    // 1. Pacote @nfewizard/shared instalado em node_modules
    path.resolve(process.cwd(), 'node_modules/@nfewizard/shared/resources/certs'),
    path.resolve(__dirname, 'node_modules/@nfewizard/shared/resources/certs'),
    path.resolve(__dirname, '../node_modules/@nfewizard/shared/resources/certs'),
    // 2. Pasta local resources/certs caso copiada no worker
    path.resolve(__dirname, 'resources/certs'),
    path.resolve(process.cwd(), 'resources/certs'),
    // 3. Fallback para require.resolve caso disponível
  ]

  try {
    const sharedPkgPath = require.resolve('@nfewizard/shared/package.json')
    const sharedDir = path.dirname(sharedPkgPath)
    candidates.unshift(path.resolve(sharedDir, 'resources/certs'))
  } catch (_) {}

  return candidates
}

/**
 * Carrega e converte certificados da cadeia ICP-Brasil para PEM
 * Converte DER (.crt/.cer binário) ou lê PEM (.pem/.crt texto)
 * Utiliza crypto.X509Certificate (suporta Buffer DER e string PEM)
 */
function loadIcpBrasilCaBundle() {
  if (icpBrasilCertsCache !== null) {
    return {
      certs: icpBrasilCertsCache,
      pemBundle: icpBrasilPemBundleCache,
      count: icpBrasilCertsCache.length,
    }
  }

  const dirs = resolveIcpBrasilCertsDirs()
  let targetDir = null
  for (const dir of dirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      targetDir = dir
      break
    }
  }

  const loadedCerts = []
  const pemParts = []

  if (targetDir) {
    try {
      const files = fs.readdirSync(targetDir).filter((f) => !f.startsWith('.'))
      for (const file of files) {
        const filePath = path.join(targetDir, file)
        try {
          const buf = fs.readFileSync(filePath)
          let pemString = ''

          // Se já for PEM legível
          const text = buf.toString('utf8')
          if (text.includes('-----BEGIN CERTIFICATE-----')) {
            pemString = text
          } else {
            // Conversão DER -> PEM via crypto.X509Certificate
            const x509 = new crypto.X509Certificate(buf)
            pemString = x509.toString()
          }

          if (pemString && pemString.includes('-----BEGIN CERTIFICATE-----')) {
            loadedCerts.push(Buffer.from(pemString))
            pemParts.push(pemString.trim())
          }
        } catch (err) {
          // Erro silencioso em arquivo individual corrompido ou não certificado
        }
      }
    } catch (readErr) {
      console.warn(
        `[DFE-TLS-WARN] Falha ao varrer diretório de certificados (${targetDir}): ${readErr.message}`,
      )
    }
  }

  // Se existir arquivo consolidado local icp-brasil-ca.pem, ler os certs adicionais
  const localPemPath = path.resolve(__dirname, 'icp-brasil-ca.pem')
  if (fs.existsSync(localPemPath)) {
    try {
      const localPem = fs.readFileSync(localPemPath, 'utf8')
      const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
      const matches = localPem.match(regex) || []
      for (const m of matches) {
        const trimmed = m.trim()
        if (!pemParts.includes(trimmed)) {
          loadedCerts.push(Buffer.from(trimmed))
          pemParts.push(trimmed)
        }
      }
    } catch (_) {}
  }

  // INCORPORAR AS CADEIAS SEFAZ / SERPRO SSL
  // 1. Tentar ler sefaz-ssl-ca.pem se existir no diretório local
  const sefazSslPath = path.resolve(__dirname, 'sefaz-ssl-ca.pem')
  let sefazPemList = []
  if (fs.existsSync(sefazSslPath)) {
    try {
      const sefazText = fs.readFileSync(sefazSslPath, 'utf8')
      const regex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
      sefazPemList = sefazText.match(regex) || []
    } catch (_) {}
  }

  // 2. Se não encontrou no arquivo sefaz-ssl-ca.pem, usar lista embutida de fallback
  if (sefazPemList.length === 0) {
    sefazPemList = SEFAZ_SERPRO_SSL_CERTS
  }

  // 3. Adicionar cada CA SSL ao bundle caso ainda não presente
  for (const pem of sefazPemList) {
    const trimmed = pem.trim()
    if (!pemParts.includes(trimmed)) {
      loadedCerts.push(Buffer.from(trimmed))
      pemParts.push(trimmed)
    }
  }

  icpBrasilCertsCache = loadedCerts
  icpBrasilPemBundleCache = pemParts.join('\n\n')

  return {
    certs: icpBrasilCertsCache,
    pemBundle: icpBrasilPemBundleCache,
    count: icpBrasilCertsCache.length,
    dirUsed: targetDir,
  }
}

/**
 * Injeta o bundle ICP-Brasil na confiança TLS global do processo Node.js
 * e configura https.globalAgent.options.ca
 */
function applyIcpBrasilTlsTrust() {
  const { certs, count } = loadIcpBrasilCaBundle()

  // Log diagnóstico OBRIGATÓRIO (Item 4 do FIX)
  console.log(`[DFE-TLS] CAs ICP-Brasil carregados: ${count}`)

  if (count > 0) {
    try {
      const rootCerts = (tls.rootCertificates || []).map((c) => Buffer.from(c))
      const combinedBundle = [...rootCerts, ...certs]

      // 1. Injetar no globalAgent padrão do https
      if (!https.globalAgent.options) {
        https.globalAgent.options = {}
      }
      https.globalAgent.options.ca = combinedBundle

      // 2. Garantir que NODE_EXTRA_CA_CERTS seja apontado caso exista o pem
      const pemPath = path.resolve(__dirname, 'icp-brasil-ca.pem')
      if (fs.existsSync(pemPath) && !process.env.NODE_EXTRA_CA_CERTS) {
        process.env.NODE_EXTRA_CA_CERTS = pemPath
      }
    } catch (e) {
      console.warn(`[DFE-TLS-WARN] Falha ao configurar https.globalAgent.options.ca: ${e.message}`)
    }
  } else {
    console.warn(
      `[DFE-TLS-WARN] Nenhum certificado ICP-Brasil foi carregado de @nfewizard/shared/resources/certs. ` +
        `Certifique-se de executar 'npm install' no worker.`,
    )
  }

  return { count, certs }
}

/**
 * Constrói ou atualiza o arquivo icp-brasil-ca.pem para ser usado via NODE_EXTRA_CA_CERTS
 */
function buildIcpBrasilCaFile(targetPath) {
  const outPath = targetPath || path.resolve(__dirname, 'icp-brasil-ca.pem')
  // Forçar recarga para não usar cache antigo
  icpBrasilCertsCache = null
  icpBrasilPemBundleCache = null
  const { pemBundle, count } = loadIcpBrasilCaBundle()
  if (count > 0 && pemBundle) {
    fs.writeFileSync(outPath, pemBundle, 'utf8')
    console.log(`[DFE-TLS] Arquivo bundle gerado com sucesso: ${outPath} (${count} certificados)`)
    return true
  }
  return false
}

class DfeAdapter {
  constructor(config) {
    this.config = config || {}
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    })
    this.wizardInstance = null
    this.isWizardLoaded = false
    this.mode = 'simulacao'
    this.modeReason = 'Inicialização pendente'
    this.cleanCnpj = String(this.config.cnpj || '').replace(/\D/g, '')

    const ufMap = {
      11: 'RO',
      12: 'AC',
      13: 'AM',
      14: 'RR',
      15: 'PA',
      16: 'AP',
      17: 'TO',
      21: 'MA',
      22: 'PI',
      23: 'CE',
      24: 'RN',
      25: 'PB',
      26: 'PE',
      27: 'AL',
      28: 'SE',
      29: 'BA',
      31: 'MG',
      32: 'ES',
      33: 'RJ',
      35: 'SP',
      41: 'PR',
      42: 'SC',
      43: 'RS',
      50: 'MS',
      51: 'MT',
      52: 'GO',
      53: 'DF',
    }
    const siglaMap = Object.entries(ufMap).reduce((acc, [code, sigla]) => {
      acc[sigla] = Number(code)
      return acc
    }, {})

    let ufSigla = 'SP'
    let cUfAutor = 35
    const rawUf = this.config.uf || this.config.sefazUf || '35'
    if (typeof rawUf === 'number' || /^\d+$/.test(String(rawUf).trim())) {
      cUfAutor = Number(rawUf)
      ufSigla = ufMap[cUfAutor] || 'SP'
    } else {
      ufSigla = String(rawUf).trim().toUpperCase()
      cUfAutor = siglaMap[ufSigla] || 35
    }
    this.ufSigla = ufSigla
    this.cUfAutor = cUfAutor
  }

  /**
   * Tenta carregar e instanciar o NFeWizard-io (API de classe v1.0.0+)
   */
  async initWizard() {
    if (this.isWizardLoaded && this.wizardInstance) {
      return true
    }

    // Injeção de confiança TLS da cadeia ICP-Brasil ANTES de inicializar o NFeWizard (FIX Itens 1, 2 e 4)
    const { certs, count } = applyIcpBrasilTlsTrust()

    try {
      let NFeWizardLib = null
      try {
        const requiredMod = require('nfewizard-io')
        NFeWizardLib = requiredMod.default || requiredMod
      } catch (reqErr) {
        this.mode = 'simulacao'
        this.modeReason = `Biblioteca 'nfewizard-io' não encontrada no node_modules (${reqErr.message}). Execute: npm install nfewizard-io @nfewizard/shared`
        return false
      }

      if (typeof NFeWizardLib !== 'function') {
        this.mode = 'simulacao'
        this.modeReason = `Export da biblioteca 'nfewizard-io' não é uma classe/construtor (${typeof NFeWizardLib})`
        return false
      }

      const wizard = new NFeWizardLib()
      if (typeof wizard.NFE_LoadEnvironment !== 'function') {
        this.mode = 'simulacao'
        this.modeReason = `Instância NFeWizard não possui o método NFE_LoadEnvironment`
        return false
      }

      // Resolver caminho absoluto do certificado PFX
      const pfxPath = path.resolve(
        process.cwd(),
        this.config.certPfxPath || './certs/certificado.pfx',
      )
      if (!fs.existsSync(pfxPath)) {
        this.mode = 'simulacao'
        this.modeReason = `Certificado PFX não encontrado no caminho: ${pfxPath}`
        return false
      }

      const tmpDistDir = path.resolve(process.cwd(), 'tmp/DistribuicaoDFe')
      try {
        if (!fs.existsSync(tmpDistDir)) {
          fs.mkdirSync(tmpDistDir, { recursive: true })
        }
      } catch (_) {}

      const cleanCnpj = String(this.config.cnpj || '').replace(/\D/g, '')
      const ambienteNum = Number(this.config.ambiente || '1') // 1 = Produção

      // Objeto de configuração do NFeWizard com as opções aceitas pela lib
      const nfeConfig = {
        dfe: {
          baixarXMLDistribuicao: true,
          pathXMLDistribuicao: tmpDistDir,
          armazenarXMLDistribuicao: true,
          armazenarRetornoEmJSON: true,
          pathRetornoEmJSON: tmpDistDir,
          pathCertificado: pfxPath,
          senhaCertificado: this.config.certPassword || '',
          UF: this.ufSigla,
          CPFCNPJ: cleanCnpj,
        },
        nfe: {
          ambiente: ambienteNum,
          versaoDF: '4.00',
        },
        lib: {
          useOpenSSL: false,
          useForSchemaValidation: 'validateSchemaJsBased',
          connection: {
            timeout: 30000,
            ...(count > 0 && {
              ca: [...tls.rootCertificates.map((c) => Buffer.from(c)), ...certs],
            }),
          },
          log: { exibirLogNoConsole: true, armazenarLogs: false },
        },
      }

      await wizard.NFE_LoadEnvironment({
        config: nfeConfig,
      })

      // Reforço TLS: Se o environment instanciou um agent próprio (Environment.agent),
      // garantir que as opções do agent recebam a cadeia completa ICP-Brasil
      try {
        const env = wizard.environment || (wizard.getEnvironment && wizard.getEnvironment())
        if (env && env.agent && env.agent.options) {
          const rootCerts = (tls.rootCertificates || []).map((c) => Buffer.from(c))
          env.agent.options.ca = [...rootCerts, ...certs]
        }
      } catch (_) {}

      this.wizardInstance = wizard
      this.isWizardLoaded = true
      this.mode = 'real'
      this.modeReason = 'Conexão SEFAZ oficial ativa via NFeWizard-io'
      return true
    } catch (loadErr) {
      this.wizardInstance = null
      this.isWizardLoaded = false
      this.mode = 'simulacao'
      this.modeReason = `Falha ao carregar ambiente NFeWizard: ${loadErr.message}`
      return false
    }
  }

  /**
   * Retorna o modo atual de operação ('real' ou 'simulacao')
   */
  getMode() {
    return {
      mode: this.mode,
      reason: this.modeReason,
    }
  }

  /**
   * Executa a consulta NFeDistribuicaoDFe por ultNSU (NT 2014.002)
   */
  async consultarPorUltNsu(ultNsu) {
    const formattedNsu = String(ultNsu || '0').padStart(15, '0')

    // Tentar inicializar NFeWizard oficial
    await this.initWizard()

    // Log OBRIGATÓRIO alto e visível em TODO ciclo
    if (this.mode === 'real') {
      console.log(
        `[DFE-MODE] real | SEFAZ Produção Oficial (NFeWizard-io) | ultNSU: ${formattedNsu}`,
      )
    } else {
      console.warn(`[DFE-MODE] simulacao | Motivo: ${this.modeReason} | ultNSU: ${formattedNsu}`)
    }

    try {
      if (this.mode === 'real' && this.wizardInstance) {
        console.log(
          `[DFE-POLL-QUERY] Consultando SEFAZ Nacional via NFeWizard (ultNSU: ${formattedNsu}, cUFAutor: ${this.cUfAutor || 35}, CNPJ: ${this.cleanCnpj})...`,
        )

        // Payload estruturado estritamente segundo o schema da NT 2014.002 / NFeDistribuicaoDFe
        // Schema espera: cUFAutor (Number), CNPJ (String 14 dígitos), distNSU { ultNSU (String 15 dígitos) }
        const payload = {
          cUFAutor: Number(this.cUfAutor || 35),
          CNPJ: String(this.cleanCnpj || '').replace(/\D/g, ''),
          distNSU: {
            ultNSU: formattedNsu,
          },
        }

        let result = null
        try {
          if (typeof this.wizardInstance.NFE_DistribuicaoDFePorNSU === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFePorNSU(payload)
          } else if (typeof this.wizardInstance.NFE_DistribuicaoDFePorUltNSU === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFePorUltNSU(payload)
          } else if (typeof this.wizardInstance.NFE_DistribuicaoDFe === 'function') {
            result = await this.wizardInstance.NFE_DistribuicaoDFe(payload)
          } else {
            throw new Error('Nenhum método compatível de Distribuição DFe encontrado no NFeWizard.')
          }
        } catch (callErr) {
          // Se NFE_DistribuicaoDFePorNSU rejeitou a assinatura ou schema, tentar NFE_DistribuicaoDFePorUltNSU ou NFE_DistribuicaoDFe genérico
          if (
            typeof this.wizardInstance.NFE_DistribuicaoDFePorUltNSU === 'function' &&
            callErr.message &&
            !callErr.message.includes('cStat')
          ) {
            console.warn('[DFE-RETRY] Tentando via NFE_DistribuicaoDFePorUltNSU...')
            result = await this.wizardInstance.NFE_DistribuicaoDFePorUltNSU(payload)
          } else if (
            typeof this.wizardInstance.NFE_DistribuicaoDFe === 'function' &&
            callErr.message &&
            !callErr.message.includes('cStat')
          ) {
            console.warn('[DFE-RETRY] Tentando via NFE_DistribuicaoDFe...')
            result = await this.wizardInstance.NFE_DistribuicaoDFe(payload)
          } else {
            throw callErr
          }
        }

        return this.parseWizardResponse(result, formattedNsu)
      }

      // Fallback para simulação
      return this.mockSefazResponse(formattedNsu)
    } catch (err) {
      console.error('[DFE-SEFAZ-ERR]', err.message)
      if (
        err.message &&
        (err.message.includes('unable to get local issuer certificate') ||
          err.message.includes('CERT_HAS_EXPIRED') ||
          err.message.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
          err.message.includes('self signed certificate'))
      ) {
        console.error(
          '[DFE-TLS-DIAGNOSTIC] Falha no handshake TLS com a SEFAZ. ' +
            'IMPORTANTE: NODE_TLS_REJECT_UNAUTHORIZED=0 JAMAIS deve ser usado (dados fiscais exigem validação estrita). ' +
            'Verifique se a cadeia ICP-Brasil está completa em @nfewizard/shared/resources/certs e no icp-brasil-ca.pem.',
        )
      }
      throw err
    }
  }

  /**
   * Mapeia a resposta real retornada pela NFeWizard-io (retDistDFeInt / docZip)
   * para o formato uniforme que o ciclo já consome:
   * { cStat, xMotivo, ultNSU, maxNSU, docs: [{ nsu, schema, accessKey, model, rawXml, ... }] }
   */
  parseWizardResponse(rawResponse, fallbackNsu) {
    if (!rawResponse) {
      return {
        cStat: '137',
        xMotivo: 'Resposta vazia da SEFAZ',
        ultNSU: fallbackNsu,
        maxNSU: fallbackNsu,
        docs: [],
      }
    }

    const retDist = rawResponse.retDistDFeInt || rawResponse.distDFeInt || rawResponse

    const cStat = String(retDist.cStat || rawResponse.cStat || '137')
    const xMotivo = String(retDist.xMotivo || rawResponse.xMotivo || '')
    const ultNSU = String(retDist.ultNSU || rawResponse.ultNSU || fallbackNsu)
    const maxNSU = String(retDist.maxNSU || rawResponse.maxNSU || ultNSU)

    const docs = []
    const lote = retDist.loteDistDFeInt || rawResponse.loteDistDFeInt

    if (lote && lote.docZip) {
      const docZipArray = Array.isArray(lote.docZip) ? lote.docZip : [lote.docZip]

      for (const item of docZipArray) {
        if (!item) continue

        const schema = item['@_schema'] || item.schema || ''
        const nsu = item['@_NSU'] || item.NSU || ''
        let base64Content = item['#text'] || item.content || item

        if (typeof base64Content === 'object' && base64Content !== null) {
          base64Content = base64Content['#text'] || ''
        }

        let unzippedXml = ''
        try {
          if (typeof base64Content === 'string' && base64Content.trim()) {
            const zipBuffer = Buffer.from(base64Content.trim(), 'base64')
            unzippedXml = zlib.gunzipSync(zipBuffer).toString('utf-8')
          }
        } catch (unzipErr) {
          // Se não estiver comprimido em gzip, pode ser o próprio XML bruto
          if (typeof base64Content === 'string' && base64Content.includes('<')) {
            unzippedXml = base64Content
          } else {
            console.error(`[DFE-UNZIP-ERR] Falha ao descompactar NSU ${nsu}: ${unzipErr.message}`)
            continue
          }
        }

        if (unzippedXml) {
          const docParsed = this.analyzeUnzippedDoc(unzippedXml, schema, nsu)
          docs.push(docParsed)
        }
      }
    }

    return {
      cStat,
      xMotivo,
      ultNSU,
      maxNSU,
      docs,
    }
  }

  /**
   * Analisa documento descompactado (NF-e, resumo, evento)
   */
  analyzeUnzippedDoc(xmlString, schema, nsu) {
    const isSummary = schema.includes('resNFe') || xmlString.includes('<resNFe')
    const isFullNfe =
      schema.includes('procNFe') || xmlString.includes('<nfeProc') || xmlString.includes('<NFe')
    const isEvent =
      schema.includes('procEvento') ||
      xmlString.includes('<procEventoNFe') ||
      xmlString.includes('<retEnvEvento') ||
      xmlString.includes('<infEvento')

    let accessKey = ''
    let emitterCnpj = ''
    let emitterName = ''
    let issueDate = ''
    let totalAmount = 0
    let nfeNumber = ''
    let model = '55'
    let eventType = ''
    let eventSeq = 1
    let justification = ''
    let protocol = ''

    // Extração da chave de acesso (44 dígitos)
    const chMatch =
      xmlString.match(/<chNFe>([0-9]{44})<\/chNFe>/i) ||
      xmlString.match(/Id=["']NFe([0-9]{44})["']/i) ||
      xmlString.match(/chNFe=([0-9]{44})/i)
    if (chMatch) accessKey = chMatch[1]

    if (accessKey && accessKey.length === 44) {
      model = accessKey.slice(20, 22)
    }

    const cnpjMatch = xmlString.match(/<CNPJ>([0-9]{14})<\/CNPJ>/i)
    if (cnpjMatch) emitterCnpj = cnpjMatch[1]

    const nomeMatch = xmlString.match(/<xNome>([^<]+)<\/xNome>/i)
    if (nomeMatch) emitterName = nomeMatch[1]

    const dhMatch =
      xmlString.match(/<dhEmi>([^<]+)<\/dhEmi>/i) || xmlString.match(/<dEmi>([^<]+)<\/dEmi>/i)
    if (dhMatch) issueDate = dhMatch[1]

    const vNfMatch = xmlString.match(/<vNF>([^<]+)<\/vNF>/i)
    if (vNfMatch) totalAmount = parseFloat(vNfMatch[1]) || 0

    const nNfMatch = xmlString.match(/<nNF>([^<]+)<\/nNF>/i)
    if (nNfMatch) nfeNumber = nNfMatch[1]

    if (isEvent) {
      const tpEventoMatch = xmlString.match(/<tpEvento>([0-9]+)<\/tpEvento>/i)
      if (tpEventoMatch) eventType = tpEventoMatch[1]

      const seqMatch = xmlString.match(/<nSeqEvento>([0-9]+)<\/nSeqEvento>/i)
      if (seqMatch) eventSeq = parseInt(seqMatch[1], 10) || 1

      const xJustMatch = xmlString.match(/<xJust>([^<]+)<\/xJust>/i)
      if (xJustMatch) justification = xJustMatch[1]

      const nProtMatch = xmlString.match(/<nProt>([^<]+)<\/nProt>/i)
      if (nProtMatch) protocol = nProtMatch[1]
    }

    return {
      nsu,
      schema,
      accessKey,
      model,
      emitterCnpj,
      emitterName,
      issueDate,
      totalAmount,
      nfeNumber,
      isSummary,
      isFullNfe,
      isEvent,
      eventType,
      eventSeq,
      justification,
      protocol,
      rawXml: xmlString,
    }
  }

  /**
   * Mock / Ensaio para validação quando NFeWizard não estiver instalado
   */
  mockSefazResponse(ultNsu) {
    const currentNsu = parseInt(ultNsu, 10) || 0
    if (currentNsu === 0) {
      return {
        cStat: '138',
        xMotivo: 'Documentos localizados (ensaio)',
        ultNSU: '000000000000002',
        maxNSU: '000000000000002',
        docs: [
          {
            nsu: '000000000000001',
            schema: 'resNFe_v1.01.xsd',
            accessKey: '35250111222333000199550010000012341000012341',
            model: '55',
            emitterCnpj: '11222333000199',
            emitterName: 'FORNECEDOR HISTORICO SOU.IS PEÇAS LTDA',
            issueDate: '2024-05-10T14:30:00-03:00',
            totalAmount: 1850.5,
            nfeNumber: '1234',
            isSummary: true,
            isFullNfe: false,
            isEvent: false,
            rawXml:
              '<resNFe><chNFe>35250111222333000199550010000012341000012341</chNFe><vNF>1850.50</vNF></resNFe>',
          },
          {
            nsu: '000000000000002',
            schema: 'resNFe_v1.01.xsd',
            accessKey: '35250122333444000188550010000056781000056782',
            model: '55',
            emitterCnpj: '22333444000188',
            emitterName: 'DISTRIBUIDORA DE AUTO PEÇAS BRASIL S/A',
            issueDate: '2024-08-15T10:15:00-03:00',
            totalAmount: 3200.0,
            nfeNumber: '5678',
            isSummary: true,
            isFullNfe: false,
            isEvent: false,
            rawXml:
              '<resNFe><chNFe>35250122333444000188550010000056781000056782</chNFe><vNF>3200.00</vNF></resNFe>',
          },
        ],
      }
    }

    return {
      cStat: '137',
      xMotivo: 'Nenhum documento localizado para o NSU informado',
      ultNSU: ultNsu,
      maxNSU: ultNsu,
      docs: [],
    }
  }
}

/**
 * Adiciona um certificado PEM dinamicamente ao cache de certificados em memória
 * e atualiza o https.globalAgent.options.ca
 */
function appendPemToBundle(pemString) {
  if (!pemString || typeof pemString !== 'string') return false
  const trimmed = pemString.trim()
  if (!trimmed.includes('-----BEGIN CERTIFICATE-----')) return false

  const { certs } = loadIcpBrasilCaBundle()
  const exists = icpBrasilPemBundleCache && icpBrasilPemBundleCache.includes(trimmed)
  if (!exists) {
    icpBrasilCertsCache.push(Buffer.from(trimmed))
    icpBrasilPemBundleCache += `\n\n${trimmed}`
    try {
      const rootCerts = (tls.rootCertificates || []).map((c) => Buffer.from(c))
      if (!https.globalAgent.options) https.globalAgent.options = {}
      https.globalAgent.options.ca = [...rootCerts, ...icpBrasilCertsCache]
    } catch (_) {}
    return true
  }
  return false
}

module.exports = DfeAdapter
module.exports.loadIcpBrasilCaBundle = loadIcpBrasilCaBundle
module.exports.applyIcpBrasilTlsTrust = applyIcpBrasilTlsTrust
module.exports.buildIcpBrasilCaFile = buildIcpBrasilCaFile
module.exports.resolveIcpBrasilCertsDirs = resolveIcpBrasilCertsDirs
module.exports.appendPemToBundle = appendPemToBundle
module.exports.SEFAZ_SERPRO_SSL_CERTS = SEFAZ_SERPRO_SSL_CERTS
