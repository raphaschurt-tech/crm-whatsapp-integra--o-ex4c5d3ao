# RPA Auto Peças — Worker Externo de Distribuição DF-e (Fase 2)

Worker Node.js independente responsável pela consulta periódica automática de NF-e (Ambiente Nacional da SEFAZ - `NFeDistribuicaoDFe`) utilizando certificado digital A1 (.pfx).

O worker opera de forma desacoplada do CRM Skip Cloud/PocketBase:
1. **O Worker é sempre o chamador (CF-1b)**: O worker roda em ambiente local (PC da RPA) ou VPS, faz chamadas de saída via HTTPS/HTTP para as rotas dedicadas do CRM (`/backend/v1/dfe/*`).
2. **Segurança do Certificado (D7, D9)**: O arquivo `.pfx` e sua senha residem **exclusivamente** na máquina do worker. O CRM nunca recebe a chave privada nem a senha.
3. **Token Dedicado (CF-1c)**: O worker autentica no CRM usando um token de escopo exclusivo gerado em *Configurações -> Captura Automática DFe* (header `X-DFe-Token` e query parameter `dfe_token`).
4. **Modo Real vs Simulação**: Quando a biblioteca `nfewizard-io` e `@nfewizard/shared` estiverem instaladas e o PFX configurado, opera automaticamente em modo `[DFE-MODE] real` conectado à SEFAZ Produção (`ambiente: '1'`).

---

## 1. Requisitos de Ambiente

- **Node.js**: versão `>= 18.0.0` (LTS recomendada: 20.x ou 22.x).
- **Sistema Operacional**: Windows 10/11 / Windows Server ou Linux (Ubuntu/Debian) em PC local ou VPS.
- **Gerenciador de Processos (CF-1d)**: `pm2` (recomendado para Linux/Windows) ou serviço do Windows via `NSSM` ou `systemd` (Linux).
- **Certificado Digital**: Certificado modelo A1 (.pfx ou .p12) válido da RPA Auto Peças (CNPJ `00.496.593/0001-29`).

---

## 2. Instalação e Configuração

### Passo 1: Descompactar e Instalar Dependências
No diretório `worker-dfe`:
```bash
npm install
```

O `package.json` já inclui todas as dependências oficiais necessárias para a SEFAZ:
- `nfewizard-io` (v1.2.0+) — motor de comunicação oficial SEFAZ NT 2014.002
- `@nfewizard/shared` — pacote de certificados CA raiz da ICP-Brasil
- `axios`, `dotenv`, `fast-xml-parser`, `node-cron`, `node-forge`

### Passo 2: Configurar o Arquivo `config.json`
Copie o modelo de exemplo `config.example.json` para `config.json`:
```bash
cp config.example.json config.json
```

Preencha os valores:
```json
{
  "CRM_URL": "https://crm-whatsapp-integracao-aee3e.shrd03.internal.goskip.dev",
  "CRM_DFE_TOKEN": "SEU_TOKEN_DFE_GERADO_NO_PAINEL_CRM",
  "SEFAZ_AMBIENTE": "1",
  "SEFAZ_UF": "35",
  "CERT_PFX_PATH": "./certs/certificado.pfx",
  "CERT_PASSWORD": "SENHA_DO_CERTIFICADO_A1",
  "COMPANY_CNPJ": "00496593000129",
  "COMMAND_POLL_INTERVAL_SECONDS": 30,
  "SEFAZ_POLL_INTERVAL_MINUTES": 60
}
```

> **Atenção**:
> - `SEFAZ_AMBIENTE`: deve ser `"1"` (Produção) para captura das compras reais. Homologação (`"2"`) não traz notas reais da empresa.
> - `CRM_URL`: utilizar o endereço PocketBase interno (`https://crm-whatsapp-integracao-aee3e.shrd03.internal.goskip.dev`).
> - Você também pode passar essas configurações via variáveis de ambiente do sistema operacional ou serviço do PM2.

### Passo 3: Colocar o Certificado A1
Crie a pasta `certs/` e insira o seu arquivo `.pfx`:
```bash
mkdir -p certs
# Copie o certificado para worker-dfe/certs/certificado.pfx
```

---

## 3. Execução em Produção com PM2 (CF-1d — Sobrevivência e Reinício Automático)

Para garantir que o worker sobreviva a reboots da máquina ou falhas temporárias de rede:

1. Instalar o PM2 globalmente:
```bash
npm install -g pm2
```

2. Iniciar o Worker DFe:
```bash
pm2 start index.js --name "rpa-worker-dfe"
```

3. Salvar para inicialização automática no boot do sistema operacional:
```bash
pm2 save
pm2 startup
```

4. Ver logs em tempo real (todos em horário de Brasília UTC-3):
```bash
pm2 logs rpa-worker-dfe
```

Você deverá ver a linha indicando o modo real:
```text
[DFE-MODE] real | SEFAZ Produção Oficial (NFeWizard-io) | ultNSU: 000000000000002
[DFE-POLL-RESPONSE] cStat: 137 (Nenhum documento localizado para o NSU informado) | Retornado ultNSU: 000000000000002
```

---

## 4. Guards e Comportamentos Homologados

- **Modo Real Automático**: detecção dinâmica da classe `NFeWizard-io`. Fallback para simulação apenas na ausência de certificado/biblioteca.
- **D1 (Fluxo Único)**: Notas completas são processadas pelo pipeline principal de NF-e do CRM (S7/S8/CFOP/MA-t/contas a pagar/custo real/pauta de preços).
- **G5 (Gate de Lançamento em Contas a Pagar)**: Só gera lançamentos se o toggle `dfe_auto_launch` estiver ativo no CRM; quando desativado, o documento é capturado no histórico e nada é lançado em contas a pagar.
- **G3 (Backlog Blindado)**: Notas registradas com `is_backlog = true` no histórico nunca geram lançamentos em contas a pagar.
- **G6 (Idempotência de Eventos)**: Eventos da SEFAZ (cancelamento, CC-e) deduplicam por `access_key + event_type + event_seq`.
- **D5 (Cancelamentos)**: Eventos de cancelamento (tpEvento 110111) de notas já processadas marcam as contas a pagar como **"NF cancelada — NÃO PAGAR"** e alertam a Fila de Exceções.
- **D7, D8, D9 (Guarda do Certificado)**: Validação automática do CNPJ do certificado contra o CNPJ configurado no CRM; alerta se validade for inferior a 30 dias; interrupção com erro explícito se o certificado estiver vencido.
- **CF-1b (Botão Consultar Agora)**: Ao clicar em "Consultar Agora" na tela do CRM, um comando é enfileirado e o worker executa o ciclo em até 30 segundos.
