/**
 * FORMATTER.JS
 * Gère la notation scientifique et les suffixes (K, M, B, T...)
 */

const Formatter = {
    // Suffixes standards pour les jeux Idle/Incremental
    suffixes: ["", "K", "M", "G", "T", "P", "E", "Z", "Y"],

    /**
     * Formate un nombre de manière lisible
     * @param {number} value - Le nombre brut
     * @param {string} unit - L'unité à ajouter (ex: "FLOPS")
     * @returns {string} - Le texte HTML formaté
     */
    format: function(value, unit = "") {
        if (value === 0) return `0 <small>${unit}</small>`;
        
        // Pour les valeurs inférieures à 1000, on affiche l'entier
        if (value < 1000) {
            return `${Math.floor(value)} <small>${unit}</small>`;
        }

        // Calcul de l'index du suffixe (Logarithme en base 1000)
        const i = Math.floor(Math.log(value) / Math.log(1000));
        
        // On limite à l'index maximum de nos suffixes
        const suffixIndex = Math.min(i, this.suffixes.length - 1);
        
        // Calcul du nombre final (ex: 1.25)
        const num = (value / Math.pow(1000, suffixIndex)).toFixed(2);
        
        return `${num} <small>${this.suffixes[suffixIndex]}${unit}</small>`;
    }
};

// On l'expose globalement pour que main.js y ait accès
window.Formatter = Formatter;
