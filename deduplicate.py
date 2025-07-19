# -*- coding: utf-8 -*-
"""
Ein Skript zur Deduplizierung von Zeilen in einer Textdatei.
Liest eine Eingabedatei, entfernt doppelte Zeilen und leere Zeilen
und schreibt das Ergebnis in eine Ausgabedatei.
"""

import sys
import os

def deduplicate_file(input_path, output_path):
    """
    Liest Zeilen aus input_path, entfernt Duplikate und leere Zeilen
    und schreibt das Ergebnis nach output_path.

    Args:
        input_path (str): Der Pfad zur Eingabedatei.
        output_path (str): Der Pfad zur Ausgabedatei.
    """
    if not os.path.exists(input_path):
        print(f"Fehler: Eingabedatei nicht gefunden unter {input_path}")
        return

    try:
        with open(input_path, 'r', encoding='utf-8') as f_in:
            # Verwendet ein Set für eine effiziente Speicherung einzigartiger Zeilen.
            # Strippt Zeilen, um Whitespace zu entfernen und leere Zeilen zu filtern.
            lines = (line.strip() for line in f_in)
            unique_lines = {line for line in lines if line}

        # Sortiert die Zeilen für eine konsistente Ausgabe.
        sorted_lines = sorted(list(unique_lines))

        with open(output_path, 'w', encoding='utf-8') as f_out:
            for line in sorted_lines:
                f_out.write(line + '\n')
        
        print(f"Deduplizierung abgeschlossen. {len(sorted_lines)} einzigartige Zeilen wurden nach {output_path} geschrieben.")

    except IOError as e:
        print(f"Ein E/A-Fehler ist aufgetreten: {e}")
    except Exception as e:
        print(f"Ein unerwarteter Fehler ist aufgetreten: {e}")


if __name__ == '__main__':
    # Stellt sicher, dass die korrekte Anzahl von Argumenten übergeben wird.
    if len(sys.argv) != 3:
        print("Verwendung: python deduplicate.py <eingabedatei> <ausgabedatei>")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]
    deduplicate_file(input_file, output_file)

