# Ponte HTTP SOU.IS -> SQL Server

Micro-serviço em Node.js (Express + driver `mssql` nativo TDS) projetado para rodar em nuvem e fazer a ponte entre o CRM de autopeças (PocketBase) e o SQL Server da **SOU.IS** (`db2.sou.is:1433`).

---

## 🎯 Por que esta ponte existe?

O fornecedor SOU.IS não disponibiliza API REST e exige consulta direta na View `VW_PRODUTO_PRECO_ESTOQUE` no SQL Server deles.
Como o ambiente de execução de hooks do PocketBase opera em uma sandbox Goja (sem sockets TCP diretos para TDS/SQL Server), esta ponte leve:
1. Conecta no SQL Server na porta `1433`;
2. Executa a leitura da View com segurança e alta performance;
3. Disponibiliza os dados em JSON via HTTP com autenticação por token (`X-Bridge-Token`);
4. Permite ao CRM sincronizar automaticamente estoque, preços (tabelas 110% e 130%) e produtos.

---

## 🚀 Opções de Hospedagem e Requisito de IP Fixo / Whitelist

> ⚠️ **ATENÇÃO CRÍTICA SOBRE O IP DE SAÍDA (EGRESS IP):**
> O firewall do SQL Server da SOU.IS só aceita conexões de IPs previamente autorizados pelo Johni / equipe de TI da SOU.IS.
> O IP atual do Skip Cloud (`34.193.171.91`) já foi liberado e testado. Quando você hospedar esta ponte, ela terá seu próprio IP de saída.

### Opção 1: Fly.io (Recomendada para IP dedicado)
- Permite deploy via Dockerfile ou CLI.
- Oferece suporte a IP de saída estático dedicado (Static Egress IP) por ~$2-3/mês.
- **Passo:** após o deploy, verifique o IP de saída e envie para o Johni da SOU.IS liberar no firewall.

### Opção 2: Render.com (Plano Gratuito com Ressalva)
- **Plano Free:** fácil de publicar direto pelo GitHub.
- **Ressalva importante:** no plano gratuito do Render, o IP de saída é compartilhado e pode variar conforme os pods reiniciam. O Render oferece "Static Outbound IP" apenas nos planos pagos. Se usar o plano Free do Render e o IP mudar, a conexão com o SQL Server cairá até o novo IP ser liberado pelo Johni.

### Opção 3: VPS Própria (Hetzner, DigitalOcean, Linode, AWS Lightsail)
- Custo de US$ 3,50 a US$ 5/mês.
- IP fixo garantido desde o primeiro minuto.

---

## ⚙️ Variáveis de Ambiente Necessárias

Copie o arquivo `env.example` para `.env` ou configure no painel da sua nuvem:

| Variável | Valor Padrão / Recomendado | Descrição |
|---|---|---|
| `MSSQL_HOST` | `db2.sou.is` | Host do SQL Server da SOU.IS |
| `MSSQL_PORT` | `1433` | Porta TDS do SQL Server |
| `MSSQL_USER` | `rpa_sp_crm` | Usuário fornecido pela SOU.IS |
| `MSSQL_PASSWORD` | `Raphael@123` | Senha fornecida pela SOU.IS |
| `MSSQL_DATABASE` | `IS_RPA` | Nome do banco de dados |
| `VIEW_NAME` | `VW_PRODUTO_PRECO_ESTOQUE` | View contendo produtos, preços e saldos |
| `BRIDGE_TOKEN` | *(crie um token secreto forte)* | Token que o CRM usará no header `X-Bridge-Token` |
| `PORT` | `3000` | Porta do servidor HTTP (injetada automaticamente pelo Render/Fly) |

---

## 📋 Passo a Passo de Deploy

### No Render.com:
1. Crie uma conta no [Render.com](https://render.com);
2. Crie um novo **Web Service** conectado ao seu repositório Git;
3. Configure:
   - **Root Directory:** `bridge-souis`
   - **Environment:** `Node` ou `Docker`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Na aba **Environment Variables**, adicione todas as variáveis da tabela acima;
5. Clique em **Deploy Web Service**;
6. Guarde a URL gerada (ex: `https://bridge-souis.onrender.com`).

### No Fly.io:
1. Instale o CLI do Fly (`curl -L https://fly.io/install.sh | sh`);
2. Entre na pasta `bridge-souis/`:
   ```bash
   cd bridge-souis
   fly launch
   ```
3. Defina as variáveis de ambiente:
   ```bash
   fly secrets set MSSQL_HOST="db2.sou.is" MSSQL_PORT="1433" MSSQL_USER="rpa_sp_crm" MSSQL_PASSWORD="Raphael@123" MSSQL_DATABASE="IS_RPA" VIEW_NAME="VW_PRODUTO_PRECO_ESTOQUE" BRIDGE_TOKEN="seu_token_secreto_aqui"
   ```
4. Faça o deploy:
   ```bash
   fly deploy
   ```

---

## 📡 Endpoints da Ponte

### 1. `GET /health`
Verifica se a ponte está de pé e testa um `SELECT 1` no SQL Server da SOU.IS. Não requer autenticação para facilitar monitoramento.
- **Resposta 200 (Sucesso):**
  ```json
  {
    "ok": true,
    "service": "souis-bridge",
    "timestamp": "2025-05-10T12:00:00.000Z",
    "latency_ms": 120,
    "sql_server": {
      "host": "db2.sou.is",
      "port": 1433,
      "database": "IS_RPA",
      "view": "VW_PRODUTO_PRECO_ESTOQUE",
      "status": "conectado"
    },
    "auth_enabled": true
  }
  ```

### 2. `GET /produtos/all`
Retorna todos os produtos da View sem limite de paginação. Usado para sincronização completa de catálogo.
- **Header:** `X-Bridge-Token: <BRIDGE_TOKEN>`
- **Resposta 200:**
  ```json
  {
    "ok": true,
    "count": 450,
    "duration_ms": 320,
    "view": "VW_PRODUTO_PRECO_ESTOQUE",
    "rows": [
      {
        "COD_PROD": "SOU-TD-001",
        "NOME_PROD": "Terminal de Direção Ford Ka",
        "lista_preco": "130%",
        "preço": 100.45,
        "saldo_prod": 15
      }
    ]
  }
  ```

### 3. `GET /produtos`
Consulta com paginação e filtros opcionais:
- `?codProd=SOU-TD-001` — busca produto específico
- `?listaPreco=130%` — filtra por tabela
- `?limit=50&offset=0` — paginação (padrão 500 linhas)
- **Header:** `X-Bridge-Token: <BRIDGE_TOKEN>`

---

## 🧪 Como Testar pós-Deploy

Substitua `SUA_URL_DA_PONTE` e `SEU_TOKEN`:

```bash
# 1. Teste de saúde e conexão com SQL Server
curl -i https://SUA_URL_DA_PONTE/health

# 2. Teste de listagem de produtos com token
curl -i -H "X-Bridge-Token: SEU_TOKEN" https://SUA_URL_DA_PONTE/produtos?limit=5

# 3. Teste de busca por código
curl -i -H "X-Bridge-Token: SEU_TOKEN" https://SUA_URL_DA_PONTE/produtos?codProd=SOU-TD-001
```

---

## 🔗 Próximo Passo no CRM

Assim que o deploy for concluído, configure os dois segredos no CRM:
1. `SOIS_BRIDGE_URL` = `https://SUA_URL_DA_PONTE`
2. `SOIS_BRIDGE_TOKEN` = `SEU_TOKEN`

Com isso, o CRM:
- Detectará a ponte no painel de diagnóstico (`GET /backend/v1/souis/diagnostics`);
- Passará a buscar os produtos e saldos reais diretamente da View da SOU.IS através do endpoint de sincronização (`POST /backend/v1/souis/sync`).
