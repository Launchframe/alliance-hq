const option = (name, description, portuguese, extra = {}) => ({
  name,
  description,
  description_localizations: { "pt-BR": portuguese },
  type: 3,
  required: false,
  ...extra,
});

const member = (name = "member", required = false) => option(name, "In-game commander name.", "Nome do comandante no jogo.", { required });
const start = () => option("start", "Start date in Server Time (YYYY-MM-DD).", "Data de início no Horário do Servidor (AAAA-MM-DD).", { max_length: 10 });
const end = () => option("end", "End date in Server Time (YYYY-MM-DD). Defaults to start.", "Data de fim no Horário do Servidor (AAAA-MM-DD). Padrão: início.", { max_length: 10 });
const date = () => option("date", "Server calendar date (YYYY-MM-DD). Defaults to today.", "Data do calendário do servidor (AAAA-MM-DD). Padrão: hoje.", { max_length: 10 });
const command = (name, description, portuguese, options) => ({ name, description, description_localizations: { "pt-BR": portuguese }, options });

export const TIME_OFF_COMMANDS = [
  command("my-time-off", "Add, view, edit or cancel your time off.", "Adicione, consulte, edite ou cancele suas ausências.", [
    member("commander"),
    option("upcoming", "Describe when you will be away; check the dates before saving.", "Descreva quando estará ausente; confira as datas antes de salvar.", { max_length: 1000 }),
    start(), end(),
    option("cancel", "Select an entry to cancel, or use latest; confirmation is required.", "Selecione uma ausência para cancelar ou use latest; é necessário confirmar."),
  ]),
  command("set-time-off", "Officers: record or manage a member’s absence.", "Oficiais: registrem ou gerenciem a ausência de um membro.", [
    member("member", true),
    option("kind", "Planned or unexpected absence.", "Ausência planejada ou inesperada.", { choices: [
      { name: "Planned absence", name_localizations: { "pt-BR": "Ausência planejada" }, value: "officer_marked" },
      { name: "Unexpected absence", name_localizations: { "pt-BR": "Ausência inesperada" }, value: "unexpected" },
    ] }),
    start(), end(),
    option("notes", "Optional private notes for the linked member and alliance officers.", "Notas privadas opcionais para o membro vinculado e os oficiais da aliança.", { max_length: 1000 }),
  ]),
  command("cancel-time-off", "Officers: choose and cancel a member’s time-off entry.", "Oficiais: escolham e cancelem uma ausência de um membro.", [
    member(),
    option("entry", "Time-off entry to select.", "Ausência a selecionar."),
  ]),
  command("who-is-away", "Officers: browse recorded alliance absences.", "Oficiais: consultem as ausências registradas da aliança.", [
    option("range", "Which period to show.", "Qual período mostrar.", { choices: [
      { name: "Today", name_localizations: { "pt-BR": "Hoje" }, value: "today" },
      { name: "This week", name_localizations: { "pt-BR": "Esta semana" }, value: "week" },
    ] }), date(),
  ]),
  command("unexpected-absences", "Officers: review recorded unexpected absences.", "Oficiais: revisem as ausências inesperadas registradas.", [date()]),
  command("is-ally-offline", "Check recorded time off, not live online status.", "Consulte as ausências registradas, não o status online em tempo real.", [member("commander", true), date()]),
];
