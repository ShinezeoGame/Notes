package com.shinezeo.notes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propres à l'application : mises à jour sans réinstaller l'APK, fichiers de l'atelier PDF, rappels.
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(NotesFilesPlugin.class);
        registerPlugin(RemindersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
