import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface SmokeCall {
  tool: string
  arguments?: Record<string, unknown>
}

const smokeMatrix: Record<string, SmokeCall[]> = {
  biomart: [
    { tool: 'biomart_list_marts' },
    { tool: 'ensembl_lookup_symbol', arguments: { species: 'homo_sapiens', symbol: 'BRCA2' } }
  ],
  pubmed: [
    { tool: 'pubmed_search', arguments: { query: 'BRCA2 cancer', maxResults: 2 } },
    { tool: 'pubmed_fetch', arguments: { pmids: ['31452104'] } }
  ],
  biorxiv: [
    {
      tool: 'biorxiv_preprints_by_date',
      arguments: { server: 'biorxiv', from: '2024-01-01', to: '2024-01-02', maxResults: 2 }
    },
    { tool: 'biorxiv_lookup_doi', arguments: { server: 'biorxiv', doi: '10.1101/2023.12.30.573731' } }
  ],
  'clinical-trials': [
    { tool: 'clinical_trials_search', arguments: { term: 'lung cancer', pageSize: 1 } },
    { tool: 'clinical_trials_get_study', arguments: { nctId: 'NCT03228186' } }
  ],
  chembl: [
    { tool: 'chembl_search_molecules', arguments: { query: 'aspirin', limit: 1 } },
    { tool: 'chembl_search_activities', arguments: { moleculeChemblId: 'CHEMBL25', limit: 1 } }
  ],
  'genes-ontologies': [
    { tool: 'mygene_query', arguments: { query: 'symbol:BRCA2', species: 'human', limit: 1 } },
    { tool: 'ols_search_terms', arguments: { query: 'apoptosis', ontology: 'go', limit: 1 } }
  ],
  'protein-annotation': [
    { tool: 'uniprot_search', arguments: { query: 'gene:BRCA2 AND organism_id:9606', limit: 1 } },
    { tool: 'interpro_protein_entries', arguments: { accession: 'P38398', limit: 1 } }
  ],
  'structures-interactions': [
    { tool: 'rcsb_get_entry', arguments: { pdbId: '4HHB' } },
    { tool: 'alphafold_prediction', arguments: { accession: 'P38398', limit: 1 } }
  ],
  variants: [
    { tool: 'clinvar_search', arguments: { query: 'BRCA2[gene]', maxResults: 1 } },
    { tool: 'dbsnp_summary', arguments: { rsids: ['rs7412'] } }
  ],
  'literature-graph': [
    { tool: 'openalex_search_works', arguments: { query: 'BRCA2 cancer', limit: 1 } },
    { tool: 'europepmc_search', arguments: { query: 'BRCA2 cancer', limit: 1 } }
  ],
  expression: [
    { tool: 'gtex_gene_search', arguments: { geneId: 'BRCA2' } },
    {
      tool: 'gtex_median_gene_expression',
      arguments: { gencodeId: 'ENSG00000134243.11', tissueSiteDetailId: 'Liver', datasetId: 'gtex_v8', limit: 1 }
    }
  ],
  'omics-archives': [
    { tool: 'geo_search', arguments: { query: 'BRCA2', maxResults: 1 } },
    { tool: 'pride_search_projects', arguments: { keyword: 'breast cancer', limit: 1 } }
  ],
  regulation: [
    { tool: 'encode_search_experiments', arguments: { searchTerm: 'CTCF', limit: 1 } },
    { tool: 'jaspar_search_motifs', arguments: { query: 'CTCF', limit: 1 } }
  ],
  'drug-regulatory': [
    { tool: 'openfda_label_search', arguments: { search: 'openfda.generic_name:aspirin', limit: 1 } },
    { tool: 'openfda_drugsfda_search', arguments: { search: 'sponsor_name:PFIZER', limit: 1 } }
  ],
  'research-resources': [
    { tool: 'nih_reporter_project_search', arguments: { text: 'cancer', limit: 1 } },
    { tool: 'nih_reporter_pi_search', arguments: { lastName: 'Collins', limit: 1 } }
  ],
  'cancer-models': [
    { tool: 'cbioportal_search_studies', arguments: { keyword: 'breast', limit: 1 } },
    { tool: 'cbioportal_list_cancer_types', arguments: { limit: 1 } }
  ],
  chemistry: [
    { tool: 'pubchem_lookup_compound', arguments: { name: 'aspirin' } },
    { tool: 'kegg_compound_get', arguments: { compoundId: 'C00031' } }
  ],
  'human-genetics': [
    { tool: 'gwas_trait_studies', arguments: { efoTrait: 'breast carcinoma', limit: 1 } },
    { tool: 'gwas_variant_associations', arguments: { rsId: 'rs7412', limit: 1 } }
  ],
  genomes: [
    { tool: 'ensembl_assembly_info', arguments: { species: 'homo_sapiens' } },
    { tool: 'ucsc_get_sequence', arguments: { genome: 'hg38', chrom: 'chr13', start: 32315086, end: 32315100 } }
  ],
  rna: [
    { tool: 'rnacentral_search', arguments: { query: 'KCNQ1OT1', limit: 1 } },
    { tool: 'rnacentral_get_entry', arguments: { ursId: 'URS000075C808', taxid: '9606' } }
  ],
  cellguide: [
    { tool: 'cell_ontology_search', arguments: { query: 'T cell', limit: 1 } },
    { tool: 'cellxgene_public_collections', arguments: { limit: 1 } }
  ],
  zinc: [
    { tool: 'zinc_files_index', arguments: { maxChars: 500 } },
    { tool: 'zinc_access_status' }
  ]
}

for (const [connector, calls] of Object.entries(smokeMatrix)) {
  test(`${connector} MCP smoke`, { timeout: 90_000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts', 'connector', connector],
      cwd: packageRoot,
      stderr: 'pipe'
    })
    const client = new Client({ name: 'open-science-smoke', version: '0.1.0' })
    try {
      await client.connect(transport)
      const tools = await client.listTools()
      const toolNames = new Set(tools.tools.map((tool) => tool.name))
      assert.ok(tools.tools.length >= calls.length)

      for (const call of calls) {
        assert.ok(toolNames.has(call.tool), `missing tool ${call.tool}`)
        const result = await client.callTool({ name: call.tool, arguments: call.arguments ?? {} })
        assert.equal(result.isError, undefined, JSON.stringify(result.content))
        assert.ok(result.content.length > 0)
      }
    } finally {
      await client.close()
    }
  })
}
