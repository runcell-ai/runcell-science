import biomart from './biomart/index.js'
import pubmed from './pubmed/index.js'
import biorxiv from './biorxiv/index.js'
import clinicalTrials from './clinical-trials/index.js'
import chembl from './chembl/index.js'
import genesOntologies from './genes-ontologies/index.js'
import proteinAnnotation from './protein-annotation/index.js'
import structuresInteractions from './structures-interactions/index.js'
import variants from './variants/index.js'
import literatureGraph from './literature-graph/index.js'
import expression from './expression/index.js'
import omicsArchives from './omics-archives/index.js'
import regulation from './regulation/index.js'
import drugRegulatory from './drug-regulatory/index.js'
import researchResources from './research-resources/index.js'
import cancerModels from './cancer-models/index.js'
import chemistry from './chemistry/index.js'
import ketcherChemistry from './ketcher-chemistry/index.js'
import humanGenetics from './human-genetics/index.js'
import genomes from './genomes/index.js'
import rna from './rna/index.js'
import cellguide from './cellguide/index.js'
import zinc from './zinc/index.js'
import type { ScienceConnectorModule } from '../types.js'

export const connectorModules: Record<string, ScienceConnectorModule> = {
  biomart,
  pubmed,
  biorxiv,
  'clinical-trials': clinicalTrials,
  chembl,
  'genes-ontologies': genesOntologies,
  'protein-annotation': proteinAnnotation,
  'structures-interactions': structuresInteractions,
  variants,
  'literature-graph': literatureGraph,
  expression,
  'omics-archives': omicsArchives,
  regulation,
  'drug-regulatory': drugRegulatory,
  'research-resources': researchResources,
  'cancer-models': cancerModels,
  chemistry,
  'ketcher-chemistry': ketcherChemistry,
  'human-genetics': humanGenetics,
  genomes,
  rna,
  cellguide,
  zinc
}

export function getConnectorModule(name: string): ScienceConnectorModule | null {
  return connectorModules[name] ?? null
}
