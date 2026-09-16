/**
 * Ponte HTTP mínima SOU.IS -> JSON
 * Conecta ao SQL Server (db2.sou.is:1433, banco IS_RPA) usando o driver TDS 'mssql'
 * e expõe a View VW_PRODUTO_PRECO_ESTOQUE em formato JSON para o PocketBase.
 */

require('dotenv').config()
const express = require('express')
const sql = require('mssql')

const app = express()
app.use(express.json())

const PORT = parseInt(process.env.PORT || '3000', 10)
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || ''

const sqlConfig = {
  user: process.env.MSSQL_USER || 'rpa_sp_crm',
  password: process.env.MSSQL_PASSWORD || 'Raphael@123',
  server: process.env.MSSQL_HOST || 'db2.sou.is',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  database: process.env.MSSQL_DATABASE || 'IS_RPA',
  options: {
    encrypt: false, // SQL Server comum / sem certificado SSL forçado
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 15000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
}

const VIEW_NAME = process.env.VIEW_NAME || 'VW_PRODUTO_PRECO_ESTOQUE'

// Pool compartilhado de conexões SQL Server
let poolPromise = null

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlConfig)
      .connect()
      .then((pool) => {
        console.log(
          `[SQL Server] Conectado com sucesso a ${sqlConfig.server}:${sqlConfig.port}/${sqlConfig.database}`,
        )
        return pool
      })
      .catch((err) => {
        console.error('[SQL Server] Erro ao conectar:', err)
        poolPromise = null
        throw err
      })
  }
  return poolPromise
}

// Middleware de autenticação por token
function authMiddleware(req, res, next) {
  // Se não houver token configurado na env var, permite acesso com aviso
  if (!BRIDGE_TOKEN) {
    return next()
  }

  const clientToken =
    req.header('X-Bridge-Token') ||
    req.header('Authorization')?.replace(/^Bearer\s+/i, '') ||
    req.query.token

  if (!clientToken || clientToken !== BRIDGE_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: 'Não autorizado. Token de autenticação inválido ou ausente no header X-Bridge-Token.',
    })
  }

  next()
}

/**
 * GET /health
 * Endpoint público de verificação de saúde da ponte e conectividade com SQL Server.
 */
app.get('/health', async (req, res) => {
  const start = Date.now()
  let sqlStatus = 'nao_testado'
  let sqlLatencyMs = 0
  let sqlError = null

  try {
    const pool = await getPool()
    const result = await pool.request().query('SELECT 1 AS alive')
    sqlLatencyMs = Date.now() - start
    sqlStatus = result.recordset?.[0]?.alive === 1 ? 'conectado' : 'ok'
  } catch (err) {
    sqlLatencyMs = Date.now() - start
    sqlStatus = 'erro_conexao'
    sqlError = {
      message: err.message,
      code: err.code || null,
      number: err.number || null,
    }
  }

  const isHealthy = sqlStatus === 'conectado' || sqlStatus === 'ok'

  return res.status(isHealthy ? 200 : 503).json({
    ok: isHealthy,
    service: 'souis-bridge',
    timestamp: new Date().toISOString(),
    latency_ms: sqlLatencyMs,
    sql_server: {
      host: sqlConfig.server,
      port: sqlConfig.port,
      database: sqlConfig.database,
      view: VIEW_NAME,
      status: sqlStatus,
      error: sqlError,
    },
    auth_enabled: Boolean(BRIDGE_TOKEN),
  })
})

/**
 * Função utilitária para buscar registros da View
 */
async function queryView({ codProd, listaPreco, limit, offset }) {
  const pool = await getPool()
  const request = pool.request()

  const safeView = VIEW_NAME.replace(/[^a-zA-Z0-9_]/g, '')
  let whereClauses = []

  if (codProd) {
    request.input('codProd', sql.VarChar, codProd)
    whereClauses.push('COD_PROD = @codProd')
  }

  if (listaPreco) {
    request.input('listaPreco', sql.VarChar, listaPreco)
    whereClauses.push('lista_preco LIKE @listaPreco')
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''

  let querySql = ''
  if (limit && limit > 0) {
    request.input('limit', sql.Int, limit)
    request.input('offset', sql.Int, offset || 0)
    // Usar paginação com ORDER BY (padrão T-SQL OFFSET FETCH)
    querySql = `
      SELECT * FROM ${safeView}
      ${whereSql}
      ORDER BY COD_PROD ASC, lista_preco ASC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `
  } else {
    // Busca completa (todos os registros da View)
    querySql = `
      SELECT * FROM ${safeView}
      ${whereSql}
      ORDER BY COD_PROD ASC, lista_preco ASC
    `
  }

  const result = await request.query(querySql)
  return result.recordset || []
}

/**
 * GET /produtos/all
 * Retorna todos os produtos da View sem limite (para sincronização completa periódica).
 */
app.get('/produtos/all', authMiddleware, async (req, res) => {
  const startTime = Date.now()
  try {
    const listaPreco = req.query.listaPreco || req.query.tabela
    const rows = await queryView({
      codProd: null,
      listaPreco: listaPreco || null,
      limit: null,
      offset: 0,
    })

    return res.json({
      ok: true,
      count: rows.length,
      duration_ms: Date.now() - startTime,
      view: VIEW_NAME,
      rows: rows,
    })
  } catch (err) {
    console.error('[GET /produtos/all] Erro ao consultar View:', err)
    return res.status(500).json({
      ok: false,
      error: 'Erro ao consultar SQL Server View',
      message: err.message,
      code: err.code || 'SQL_QUERY_FAILED',
      sql_host: sqlConfig.server,
      sql_port: sqlConfig.port,
    })
  }
})

/**
 * GET /produtos
 * Consulta com filtros opcionais:
 * - codProd: código exato do produto (ex: 'SOU-TD-001')
 * - listaPreco: filtro de lista (ex: '130%', '110%')
 * - limit: quantidade máxima de linhas (padrão: 500, passar limit=0 para todos)
 * - offset: paginação (padrão: 0)
 */
app.get('/produtos', authMiddleware, async (req, res) => {
  const startTime = Date.now()
  try {
    const codProd = req.query.codProd || req.query.cod_prod || req.query.sku
    const listaPreco = req.query.listaPreco || req.query.lista_preco || req.query.tabela

    let limit = 500
    if (req.query.limit !== undefined) {
      const parsedLimit = parseInt(req.query.limit, 10)
      limit = isNaN(parsedLimit) ? 500 : parsedLimit
    }

    let offset = 0
    if (req.query.offset !== undefined) {
      const parsedOffset = parseInt(req.query.offset, 10)
      offset = isNaN(parsedOffset) ? 0 : parsedOffset
    }

    const rows = await queryView({
      codProd: codProd || null,
      listaPreco: listaPreco || null,
      limit: limit === 0 ? null : limit,
      offset: offset,
    })

    return res.json({
      ok: true,
      count: rows.length,
      limit: limit === 0 ? 'ilimitado' : limit,
      offset: offset,
      duration_ms: Date.now() - startTime,
      view: VIEW_NAME,
      rows: rows,
    })
  } catch (err) {
    console.error('[GET /produtos] Erro ao consultar View:', err)
    return res.status(500).json({
      ok: false,
      error: 'Erro ao consultar SQL Server View',
      message: err.message,
      code: err.code || 'SQL_QUERY_FAILED',
      sql_host: sqlConfig.server,
      sql_port: sqlConfig.port,
    })
  }
})

// Rota raiz para conferência
app.get('/', (req, res) => {
  res.json({
    name: 'SOU.IS SQL Server HTTP Bridge',
    status: 'online',
    endpoints: {
      health: 'GET /health',
      produtos_todos: 'GET /produtos/all',
      produtos_filtrados: 'GET /produtos?codProd=X&listaPreco=130%&limit=50',
    },
    doc: 'Veja o README.md na raiz do microserviço para instruções de deploy.',
  })
})

// Tratamento de rotas inexistentes
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Rota não encontrada' })
})

// Inicia servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Ponte SOU.IS] Servidor HTTP rodando na porta ${PORT}`)
  console.log(
    `[Ponte SOU.IS] SQL Server alvo: ${sqlConfig.server}:${sqlConfig.port}/${sqlConfig.database}`,
  )
  console.log(
    `[Ponte SOU.IS] Autenticação por token: ${BRIDGE_TOKEN ? 'HABILITADA' : 'DESABILITADA'}`,
  )
})
