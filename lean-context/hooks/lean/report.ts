import { MATERIAL_SHARE, MIN_SAMPLES, NEGLIGIBLE_SHARE, RECENT_SHOWN } from './config'
import { BYTES_PER_TOKEN, formatInt, formatKbPt, formatPercent, formatTokens } from './estimate'
import { describeDecision } from './mode'
import type { Decision } from './mode'
import { verdictOf } from './proposal'
import { abStats } from './records'
import type { AbStats, ConversationRecord, Diag } from './records'
import { pointerLine } from './sections'

export type PanelData = {
  version: string
  instructionFile: string
  applyCut: boolean
  current?: Decision
  inertWhy?: string
  record?: ConversationRecord
  history: readonly ConversationRecord[]
  diag?: Diag
}

const NOTE =
  'Nota: o prefixo vai em cache e 4k tokens pesam pouco numa janela de 200k/1M. O custo maior de uma tarefa pequena e provavelmente comportamental (o modelo seguir um processo longo para mudar uma linha): hipotese, nao medida por este mod.'

export function verdictLines(savedTokens: number, stats: AbStats, windowTokens?: number): string[] {
  const { withoutCut, withCut } = stats
  const baseline =
    withoutCut.meanTokens ?? (withCut.meanTokens === undefined ? undefined : withCut.meanTokens + savedTokens)
  const samples = withoutCut.n + withCut.n

  if (baseline === undefined || baseline <= 0) {
    return ['Sem 1o pedido medido em modo lean: ainda nao ha base para decidir.']
  }

  const share = savedTokens / baseline
  const windowPart =
    windowTokens === undefined || windowTokens <= 0
      ? ''
      : `, ${formatPercent(savedTokens / windowTokens)} da janela de ${formatInt(windowTokens)}`
  const lines = [
    `Base: 1o pedido medio de ${formatInt(baseline)} tokens (n=${samples}). O corte retira ~${formatInt(savedTokens)} = ${formatPercent(share)} do 1o pedido${windowPart}.`,
  ]

  const verdict = verdictOf(share)
  if (verdict === 'negligible') {
    lines.push('Veredicto: ganho desprezivel em tokens; nao justifica aplicar so por isso.')
  } else if (verdict === 'modest') {
    lines.push('Veredicto: ganho modesto; so justifica aplicar se o problema for comportamental.')
  } else {
    lines.push('Veredicto: ganho material em tokens; justifica aplicar.')
  }
  lines.push(
    `(limiares heuristicos: <${formatPercent(NEGLIGIBLE_SHARE)} desprezivel, >=${formatPercent(MATERIAL_SHARE)} material)`,
  )

  if (samples < MIN_SAMPLES) {
    lines.push(`Amostra pequena (n<${MIN_SAMPLES}): leitura provisoria.`)
  }
  if (withoutCut.n >= 2 && withCut.n >= 2 && withoutCut.meanTokens !== undefined && withCut.meanTokens !== undefined) {
    const measured = withCut.meanTokens - withoutCut.meanTokens
    lines.push(
      `A/B medido: com corte ${formatInt(withCut.meanTokens)} vs sem corte ${formatInt(withoutCut.meanTokens)} (${measured >= 0 ? '+' : ''}${formatInt(measured)} tokens; estimado -${formatInt(savedTokens)}).`,
    )
  }
  return lines
}

const when = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

const measured = (value: number | undefined): string =>
  value === undefined ? 'n/m' : formatInt(value)

function weightLines(record: ConversationRecord): string[] {
  const weights = record.weights
  if (weights === undefined) return ['  (ainda sem breakdown: registado no fim do 1o turno)']

  const used = weights.categories
    .filter(category => category.kind === 'used' && category.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
  const lines = [
    `  total ${formatInt(weights.totalTokens)} de ${formatInt(weights.maxTokens)} tokens (estimativa local)`,
    ...used.map(category => `  ${category.name}: ${formatInt(category.tokens)}`),
  ]
  if (weights.skills) {
    lines.push(
      `  skills: ${weights.skills.included}/${weights.skills.total} listadas, ${formatInt(weights.skills.tokens)} tokens`,
    )
  }
  if (weights.slashCommandTokens !== undefined) {
    lines.push(`  comandos: ${formatInt(weights.slashCommandTokens)} tokens`)
  }
  lines.push(`  agentes: ${formatInt(weights.agentTokens)} tokens`)
  for (const server of weights.mcp) {
    lines.push(
      `  mcp ${server.server}: ${server.loaded}/${server.tools} ferramentas carregadas, ${formatInt(server.loadedTokens)} tokens`,
    )
  }
  for (const file of weights.memory.slice(0, 6)) {
    lines.push(`  memoria ${file.file} (${file.type}): ${formatInt(file.tokens)} tokens`)
  }
  return lines
}

function conversationLines(record: ConversationRecord): string[] {
  const applied = record.applied ? 'corte APLICADO' : 'corte nao aplicado (simulacao ou modo full)'
  const lines = [
    `esta conversa: 1a mensagem em modo ${record.mode} (${record.detail}); ${applied}; leituras do contexto: ${record.reads}`,
    `  1o pedido real: ${record.firstRequestTokens === undefined ? 'ainda nao medido' : `${formatInt(record.firstRequestTokens)} tokens`}; fim do 1o turno: ${record.turnEndTokens === undefined ? 'ainda nao medido' : `${formatInt(record.turnEndTokens)} tokens`}`,
    `  ordem observada dos eventos: ${record.seq.length === 0 ? 'por observar' : record.seq.join(' > ')}`,
  ]
  if (record.missing.length > 0) lines.push(`  titulos nao encontrados: ${record.missing.join(' | ')}`)
  for (const drift of record.drift) {
    lines.push(
      `  AVISO: seccao "${drift.title}" tem ${formatInt(drift.actualBytes)} B (esperado ~${formatInt(drift.expectedBytes)} B); rever a lista`,
    )
  }
  if (record.isAgentsInText === false) {
    lines.push('  AVISO: o texto das seccoes nao aparece no bloco claudeMd; confirmar com /context')
  }
  return lines
}

export function renderPanel(data: PanelData): string {
  const lines = [
    `lean-context ${data.version}`,
    data.applyCut
      ? 'corte: APLICADO a conversas novas em modo lean (/lean simulate para voltar atras)'
      : 'corte: SIMULADO, nada e retirado do contexto (/lean apply para aplicar)',
  ]

  if (data.current !== undefined) lines.push(`modo agora: ${describeDecision(data.current)}`)
  if (data.inertWhy !== undefined) lines.push(`modo agora: nao se aplica aqui (${data.inertWhy})`)

  if (data.record === undefined) {
    lines.push('esta conversa: sem registo (o modo e decidido quando o contexto da 1a mensagem e montado)')
  } else {
    lines.push(...conversationLines(data.record))
    const saved = data.record.savedBytes
    lines.push(
      `poupanca estimada: ${formatKbPt(saved)} KB = ~${formatTokens(Math.round(saved / BYTES_PER_TOKEN))} tokens (${BYTES_PER_TOKEN} bytes/token)`,
    )
    for (const section of data.record.cut) {
      lines.push(`  ${pointerLine(data.instructionFile, section.title, section.bytes)}`)
    }
    lines.push('peso do contexto desta conversa:', ...weightLines(data.record))
  }

  const recent = data.history.slice(-RECENT_SHOWN)
  lines.push(`ultimas ${recent.length} conversas (mais recente no fim):`)
  if (recent.length === 0) lines.push('  (nenhuma)')
  for (const record of recent) {
    lines.push(
      `  ${when(record.startedAt)} modo=${record.mode} corte=${record.applied ? 'sim' : 'nao'} 1o-pedido=${measured(record.firstRequestTokens)} poupanca-est=${formatTokens(record.savedTokens)}`,
    )
  }

  const stats = abStats(data.history)
  const savedTokens = data.record?.savedTokens ?? data.history.at(-1)?.savedTokens ?? 0
  const windowTokens = data.record?.windowTokens ?? data.history.at(-1)?.windowTokens
  lines.push(
    `A/B (so modo lean com 1o pedido medido): sem corte n=${stats.withoutCut.n} media=${measured(stats.withoutCut.meanTokens)}; com corte n=${stats.withCut.n} media=${measured(stats.withCut.meanTokens)}`,
    ...verdictLines(savedTokens, stats, windowTokens),
    NOTE,
  )

  if (data.diag !== undefined) lines.push(`ultimo evento do contexto: ${data.diag.note}`)
  return lines.join('\n')
}

export function statusText(record: ConversationRecord): string {
  if (record.mode === 'full') return `lean: full (${record.reason})`
  const saved = formatTokens(record.savedTokens)
  return record.applied ? `lean: cortado -${saved} tokens` : `lean: simulado -${saved} tokens`
}

export function composeNote(titles: readonly string[], instructionFile: string): string {
  return `lean-context: lean mode is active in this conversation (no active spec for the branch). The project context omits these ${instructionFile} sections: ${titles.join('; ')}. Each omission leaves a one-line pointer; read the section on demand when the task depends on it.`
}

export function reminderText(titles: readonly string[], reason: string, instructionFile: string): string {
  return `[lean-context] The mode changed from lean to full (${reason}), but this conversation's context still lacks these ${instructionFile} sections: ${titles.join('; ')}. Read them in ${instructionFile} before continuing any work that depends on them.`
}
