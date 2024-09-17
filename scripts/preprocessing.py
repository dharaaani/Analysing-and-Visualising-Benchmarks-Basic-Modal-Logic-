import os
import pandas as pd
import mysql.connector
import sys
from sklearn.decomposition import PCA
from sklearn.preprocessing import OneHotEncoder
from sklearn.impute import SimpleImputer

def preprocess_dataset(file_path):
    print(f"Processing file: {file_path}")  # Debugging statement
    df = load_and_inspect(file_path)
    
    # Check for duplicate columns
    if check_for_duplicate_columns(df):
        print("Duplicate columns found. Stopping process.")
        return  # Stop processing if duplicates are found

    # Determine dataset type based on specific conditions
    if "3CNF" in df.iloc[2, 1]:
        print("Processing as 3CNF dataset...")
        df = preprocess_generic(df, file_path)
    elif "qbf" in df.iloc[2, 1]:
        print("Processing as MQBF dataset...")
        df = preprocess_generic(df, file_path)
    elif "lwb" in df.iloc[2, 1].lower():
        print("Processing as LWB dataset...")
        df = preprocess_generic(df, file_path)
    else:
        raise ValueError("Unknown dataset type. Cannot process.")
    

    insert_data_into_db(df)
    save_cleaned_data(df, file_path)
   

    # Perform PCA and select 100 rows
    selected_df = perform_pca(df)
    save_selected_data(selected_df, file_path)

def load_and_inspect(file_path):
    print("Loading data...")  # Debugging statement
    df = pd.read_csv(file_path, delimiter=';', on_bad_lines='skip', header=None)
    print("Data loaded successfully.")
    print(df.head())  # Display the first few rows for debugging
    return df

def check_for_duplicate_columns(df):
    """Check for duplicate columns in the dataframe."""
    duplicates = df.columns[df.columns.duplicated()].tolist()
    if duplicates:
        print(f"Duplicate columns detected: {duplicates}")
        return True
    return False

def preprocess_generic(df, file_path):
    # Define columns based on your requirements
    df.columns = ['id', 'Prover_Problem', 'Execution Time', 'Result', 'Extra']

    # Split the 'Prover_Problem' column into 'Prover' and 'Problem'
    df[['Prover', 'Problem']] = df['Prover_Problem'].str.split('/', n=1, expand=True)

    # Strip whitespace and handle non-numeric values in 'Execution Time'
    df['Execution Time'] = df['Execution Time'].str.strip()

    # Handle specific problematic non-numeric values
    problematic_values = ['snf+#negative6', 'timeout', 'TIMEOUT', ' TIMEOUT']
    df['Execution Time'] = df['Execution Time'].replace(problematic_values, 9999999, regex=False)
    
    # Attempt to convert the 'Execution Time' column to float, replacing any remaining problematic values with NaN
    df['Execution Time'] = pd.to_numeric(df['Execution Time'], errors='coerce')

    # Convert empty 'Result' fields to 'NULL' string
    df['Result'] = df['Result'].replace(r'^\s*$', 'NULL', regex=True)

    # Remove specific substrings from 'Problem'
    substrings_to_remove = ['tptp', 'intohylo', 'spartacus']
    for substring in substrings_to_remove:
        df['Problem'] = df['Problem'].str.replace(substring, '', regex=False).str.strip()

    # Add a new 'System' column based on the 'Problem' field and the file path
    df['System'] = df['Problem'].apply(lambda problem: assign_system_from_filename(problem, file_path))

    # Reorder columns according to your specifications
    df = df[['id', 'Prover', 'System', 'Problem', 'Execution Time', 'Result']]

    df = df.drop(columns=['id'])

    return df

def assign_system_from_filename(problem, filename):
    """Assigns system name based on the filename."""
    if pd.isna(problem):
        return 'unknown'
    filename = filename.lower()
    if 'bddtab' in filename:
        return 'bbtab'
    elif 'inkresat' in filename:
        return 'inkresat'
    elif 'vampire' in filename:
        return 'vampire'
    elif 'ksp' in filename:
        return 'ksp'
    elif 'spartacus' in filename:
        return 'spartacus'
    else:
        return 'unknown'

def insert_data_into_db(df):
    # Replace NaN with None (which translates to NULL in MySQL)
    df = df.where(pd.notnull(df), None)
    
    # Establish the database connection
    conn = mysql.connector.connect(
        host='localhost',
        user='root',
        password='Dharani13@',
        database='benchmark_db'
    )
    cursor = conn.cursor()

    insert_query = """
    INSERT INTO measurements (Prover, System_name, Problem, Execution_Time, Result)
    VALUES (%s, %s, %s, %s, %s)
    """

    check_duplicate_query = """
    SELECT COUNT(*) FROM measurements 
    WHERE Prover = %s AND System_name = %s AND Problem = %s AND Execution_Time = %s AND Result = %s
    """
    
    for _, row in df.iterrows():
        # Handle NaN values explicitly
        row_values = [None if pd.isna(val) else val for val in [row['Prover'], row['System'], row['Problem'], row['Execution Time'], row['Result']]]

        print("Checking for duplicates for row:", row_values)  # Debugging statement
        cursor.execute(check_duplicate_query, tuple(row_values))
        duplicate_count = cursor.fetchone()[0]
        
        if duplicate_count == 0:
            print("Inserting row:", row_values)  # Debugging statement
            try:
                cursor.execute(insert_query, tuple(row_values))
                conn.commit()
                print("Row inserted successfully.")  # Confirmation of success
            except mysql.connector.Error as err:
                print(f"Error: {err}")
                conn.rollback()
                print("Rollback executed due to error.")  # Debugging statement
        else:
            print("Duplicate row found. Skipping insertion.")  # Debugging statement

    cursor.close()
    conn.close()
    print("Database connection closed.")  # Debugging statement

def save_cleaned_data(df, file_path):
    # Reset index if necessary
    df = df.reset_index(drop=True)
    df = df.drop(index=0)

    output_file_path = file_path.replace('.csv', '_output.csv')
    df.to_csv(output_file_path, index=False)
    print(f"Cleaned dataset saved as '{output_file_path}'")

def perform_pca(df):
    # Select relevant columns for PCA
    numerical_features = df[['Execution Time']]
    categorical_features = df[['Prover', 'System', 'Result']]

    # One-hot encode the categorical features
    encoder = OneHotEncoder(sparse_output=False, drop='first')
    encoded_features = encoder.fit_transform(categorical_features)

    # Combine the numerical and encoded categorical features
    features = pd.concat([numerical_features.reset_index(drop=True), pd.DataFrame(encoded_features)], axis=1)

    # Ensure all column names are strings
    features.columns = features.columns.astype(str)

    # Handle NaN values
    imputer = SimpleImputer(strategy='mean')  # You can use 'mean', 'median', or other strategies
    features_imputed = imputer.fit_transform(features)

    # Perform PCA
    pca = PCA(n_components=2)
    principal_components = pca.fit_transform(features_imputed)

    # Convert PCA result to DataFrame
    pca_df = pd.DataFrame(data=principal_components, columns=['PC1', 'PC2'])

    # Add the Problem, Prover, and System columns back to the PCA result
    pca_df = pd.concat([pca_df, df[['Problem', 'Prover', 'System']].reset_index(drop=True)], axis=1)
    
    # Select the top 100 rows based on the largest absolute values in PC1 and PC2
    pca_df['Magnitude'] = (pca_df['PC1']**2 + pca_df['PC2']**2)**0.5
    pca_df_sorted = pca_df.sort_values(by='Magnitude', ascending=False).head(100)

    # Drop the Magnitude column
    pca_df_sorted = pca_df_sorted.drop(columns=['Magnitude'])

    return pca_df_sorted


def save_selected_data(df, file_path):
    output_file_path = file_path.replace('.csv', '_selected_100.csv')
    df.to_csv(output_file_path, index=False)
    print(f"Selected 100 rows saved as '{output_file_path}'")


if __name__ == "__main__":
    print("Script started.")  # Debugging statement
    if len(sys.argv) > 1:
        preprocess_dataset(sys.argv[1])
    else:
        print("No file path provided.")
    print("Script completed.")  # Debugging statement
