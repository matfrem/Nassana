import type { Task } from './types'

const COLORS = ['#FFE066', '#FFADAD', '#9BF6FF', '#CAFFBF', '#FFC6FF', '#FDFFB6']

const TITLES = [
  'Préparer la réunion',
  'Relire le contrat',
  'Appeler le client',
  'Maquette page d’accueil',
  'Mettre à jour la doc',
  'Corriger le bug #42',
  'Planifier le sprint',
  'Commander le matériel',
  'Revue de code',
  'Envoyer la facture',
  'Atelier design',
  'Veille techno',
]

/** Données factices en attendant le branchement Google Sheets. */
export function demoTasks(): Task[] {
  return TITLES.map((title, i) => ({
    id: `demo-${i}`,
    title,
    board: {
      x: (i % 4) * 220 - 330,
      y: Math.floor(i / 4) * 220 - 220,
      color: COLORS[i % COLORS.length],
    },
  }))
}
