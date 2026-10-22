"""Optional offline XSD validation: python tools/validate-musicxml.py XML SCHEMA_DIR.

Requires lxml. SCHEMA_DIR contains the unchanged MusicXML 4.0 musicxml.xsd,
xml.xsd and xlink.xsd from an official schema distribution.
"""
import sys
from pathlib import Path
from lxml import etree

source = Path(sys.argv[1]).resolve()
folder = Path(sys.argv[2]).resolve()


class LocalSchemas(etree.Resolver):
    def resolve(self, url, public_id, context):
        candidate = folder / Path(url).name
        if candidate.name in {"musicxml.xsd", "xml.xsd", "xlink.xsd"} and candidate.is_file():
            return self.resolve_filename(str(candidate), context)
        return None


parser = etree.XMLParser(no_network=True, resolve_entities=False)
parser.resolvers.add(LocalSchemas())
schema = etree.XMLSchema(etree.parse(str(folder / "musicxml.xsd"), parser))
schema.assertValid(etree.parse(str(source), parser))
print(f"MusicXML 4.0 XSD validation passed: {source.name}")
