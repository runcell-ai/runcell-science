import type { ScienceConnectorDefinition } from './types.js'

const cliArgs = (name: string) => ['packages/science-connectors/dist/cli.js', 'connector', name]

export const bundledScienceConnectors: ScienceConnectorDefinition[] = [
  {
    id: 'bundled:biomart',
    name: 'biomart',
    displayName: 'BioMart',
    description: 'Ensembl BioMart genomic annotations, identifier translation, and tabular queries.',
    batch: 'P0',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('biomart'),
    upstreams: [
      {
        name: 'Ensembl BioMart / Ensembl REST',
        termsUrl: 'https://www.ensembl.org/info/about/legal/disclaimer.html'
      }
    ],
    status: 'implemented',
    toolCount: 4
  },
  {
    id: 'bundled:pubmed',
    name: 'pubmed',
    displayName: 'PubMed',
    description: 'NCBI PubMed search, article summaries, abstracts, and related article discovery.',
    batch: 'P0',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('pubmed'),
    upstreams: [
      {
        name: 'NCBI E-utilities / PubMed',
        termsUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/'
      }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:biorxiv',
    name: 'biorxiv',
    displayName: 'bioRxiv',
    description: 'bioRxiv and medRxiv preprint metadata by date range, term filter, and DOI.',
    batch: 'P0',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('biorxiv'),
    upstreams: [
      { name: 'bioRxiv', license: 'Per article', infoUrl: 'https://www.biorxiv.org/tdm' },
      { name: 'medRxiv', license: 'Per article', infoUrl: 'https://www.medrxiv.org/tdm' }
    ],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:clinical-trials',
    name: 'clinical-trials',
    displayName: 'Clinical Trials',
    description: 'ClinicalTrials.gov v2 study search and study detail lookup.',
    batch: 'P0',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('clinical-trials'),
    upstreams: [
      {
        name: 'ClinicalTrials.gov',
        termsUrl: 'https://clinicaltrials.gov/about-site/terms-conditions'
      }
    ],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:chembl',
    name: 'chembl',
    displayName: 'ChEMBL',
    description: 'ChEMBL compound, target, and bioactivity search.',
    batch: 'P0',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('chembl'),
    upstreams: [
      {
        name: 'ChEMBL',
        license: 'CC-BY-SA 3.0',
        termsUrl: 'https://chembl.github.io/chembl-licensing/'
      }
    ],
    status: 'implemented',
    toolCount: 4
  },
  {
    id: 'bundled:genes-ontologies',
    name: 'genes-ontologies',
    displayName: 'Genes & Ontologies',
    description: 'Gene lookup, ontology term search, and GO annotation queries.',
    batch: 'P1',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('genes-ontologies'),
    upstreams: [
      { name: 'MyGene.info', termsUrl: 'https://mygene.info/terms/' },
      { name: 'EBI OLS', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' },
      { name: 'QuickGO', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:protein-annotation',
    name: 'protein-annotation',
    displayName: 'Protein Annotation',
    description: 'UniProtKB protein lookup plus InterPro domain and family mappings.',
    batch: 'P1',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('protein-annotation'),
    upstreams: [
      { name: 'UniProt', termsUrl: 'https://www.uniprot.org/help/license' },
      { name: 'InterPro', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:structures-interactions',
    name: 'structures-interactions',
    displayName: 'Structures & Interactions',
    description: 'RCSB PDB structure metadata and AlphaFold DB prediction links.',
    batch: 'P1',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('structures-interactions'),
    upstreams: [
      { name: 'RCSB PDB', termsUrl: 'https://www.rcsb.org/pages/policies' },
      { name: 'AlphaFold DB', termsUrl: 'https://alphafold.ebi.ac.uk/terms-of-use' }
    ],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:variants',
    name: 'variants',
    displayName: 'Variants',
    description: 'ClinVar search and summaries plus dbSNP rsID summaries through public NCBI APIs.',
    batch: 'P1',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('variants'),
    upstreams: [
      { name: 'ClinVar', infoUrl: 'https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/' },
      { name: 'dbSNP', termsUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:literature-graph',
    name: 'literature-graph',
    displayName: 'Literature Graph',
    description: 'OpenAlex and Europe PMC literature search, DOI lookup, and citation metadata.',
    batch: 'P1',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('literature-graph'),
    upstreams: [
      { name: 'OpenAlex', termsUrl: 'https://openalex.org/terms' },
      { name: 'Europe PMC', termsUrl: 'https://europepmc.org/AnnotationsApi' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:expression',
    name: 'expression',
    displayName: 'Expression',
    description: 'GTEx gene reference and tissue expression lookup.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('expression'),
    upstreams: [{ name: 'GTEx Portal', termsUrl: 'https://gtexportal.org/home/termsOfUse' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:omics-archives',
    name: 'omics-archives',
    displayName: 'Omics Archives',
    description: 'GEO DataSets and PRIDE archive project search.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('omics-archives'),
    upstreams: [
      { name: 'NCBI GEO DataSets', termsUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/' },
      { name: 'PRIDE Archive', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:regulation',
    name: 'regulation',
    displayName: 'Regulation',
    description: 'ENCODE experiment metadata and JASPAR motif search.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('regulation'),
    upstreams: [
      { name: 'ENCODE', termsUrl: 'https://www.encodeproject.org/help/terms/' },
      { name: 'JASPAR', termsUrl: 'https://jaspar.elixir.no/about/' }
    ],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:drug-regulatory',
    name: 'drug-regulatory',
    displayName: 'Drug Regulatory',
    description: 'openFDA label and Drugs@FDA application search.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('drug-regulatory'),
    upstreams: [{ name: 'openFDA', termsUrl: 'https://open.fda.gov/terms/', license: 'Public domain / openFDA terms' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:research-resources',
    name: 'research-resources',
    displayName: 'Research Resources',
    description: 'NIH RePORTER funded project and PI search.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('research-resources'),
    upstreams: [{ name: 'NIH RePORTER', termsUrl: 'https://reporter.nih.gov/' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:cancer-models',
    name: 'cancer-models',
    displayName: 'Cancer Models',
    description: 'cBioPortal public study and cancer type metadata.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('cancer-models'),
    upstreams: [{ name: 'cBioPortal', termsUrl: 'https://www.cbioportal.org/terms' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:chemistry',
    name: 'chemistry',
    displayName: 'Chemistry',
    description: 'PubChem, ChEBI via OLS, and KEGG compound lookup.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('chemistry'),
    upstreams: [
      { name: 'PubChem', termsUrl: 'https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access' },
      { name: 'ChEBI via OLS', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' },
      { name: 'KEGG REST', termsUrl: 'https://www.kegg.jp/kegg/legal.html' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:human-genetics',
    name: 'human-genetics',
    displayName: 'Human Genetics',
    description: 'GWAS Catalog trait study and variant association lookup.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('human-genetics'),
    upstreams: [{ name: 'GWAS Catalog', termsUrl: 'https://www.ebi.ac.uk/gwas/docs/about' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:genomes',
    name: 'genomes',
    displayName: 'Genomes',
    description: 'Ensembl assembly metadata and UCSC sequence/track interval lookup.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('genomes'),
    upstreams: [
      { name: 'Ensembl REST', termsUrl: 'https://www.ensembl.org/info/about/legal/disclaimer.html' },
      { name: 'UCSC Genome Browser API', termsUrl: 'https://genome.ucsc.edu/license/' }
    ],
    status: 'implemented',
    toolCount: 3
  },
  {
    id: 'bundled:rna',
    name: 'rna',
    displayName: 'RNA',
    description: 'RNAcentral non-coding RNA search and entry lookup.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('rna'),
    upstreams: [{ name: 'RNAcentral', termsUrl: 'https://rnacentral.org/api' }],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:cellguide',
    name: 'cellguide',
    displayName: 'CellGuide',
    description: 'Cell Ontology search and CELLxGENE public collection metadata.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('cellguide'),
    upstreams: [
      { name: 'EBI OLS Cell Ontology', termsUrl: 'https://www.ebi.ac.uk/about/terms-of-use' },
      { name: 'CELLxGENE Discover', termsUrl: 'https://cellxgene.cziscience.com/privacy' }
    ],
    status: 'implemented',
    toolCount: 2
  },
  {
    id: 'bundled:zinc',
    name: 'zinc',
    displayName: 'ZINC',
    description: 'ZINC public file index and access-status probes for programmatic use boundaries.',
    batch: 'P2',
    transport: 'stdio',
    auth: 'none',
    command: 'node',
    args: cliArgs('zinc'),
    upstreams: [
      {
        name: 'ZINC / CartBlanche',
        termsUrl: 'https://zinc.docking.org/about',
        notes: 'Search endpoints may require interactive access controls; connector does not scrape or bypass challenges.'
      }
    ],
    status: 'implemented',
    toolCount: 2
  }
]

export function findBundledScienceConnector(name: string): ScienceConnectorDefinition | null {
  return bundledScienceConnectors.find((connector) => connector.name === name || connector.id === `bundled:${name}`) ?? null
}
