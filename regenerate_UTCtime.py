from lxml import etree
from datetime import datetime
import sys


def print_usage():
    print("Usage : python regenerate_UTCtime.py [filename]")
    sys.exit(0)

def re_generate(filename):
    tree = etree.parse(filename)
    root = tree.getroot()
    etree.tostring(root, xml_declaration=True)
    root.attrib['availabilityStartTime'] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    tree.write(filename, encoding='utf-8', xml_declaration=True)

def main():
    if len(sys.argv) is not 2:
        print_usage()

    re_generate(sys.argv[1])

if __name__ == "__main__":
    main()
